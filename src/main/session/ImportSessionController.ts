/**
 * ImportSessionController (item 0026).
 *
 * Owns the lifecycle of one offline audio-file import. It is the import-side
 * counterpart of LiveSessionController: instead of mic/loopback, the PCM frames
 * arrive from a decoded file (streamed by the renderer), but the downstream
 * pipeline is identical.
 *
 *   start()        — upsert the meeting (state 'live', source 'import'), persist
 *                    the user-supplied agenda + participants, build the ASR
 *                    provider, and begin draining its spans into the span repo.
 *   pushFrame()    — forward a decoded PCM frame to the ASR provider.
 *   finish()       — stop the ASR provider, wait for all spans to drain, then
 *                    (optionally) infer the agenda + participants from the
 *                    transcript, run the same final extraction pass as a live
 *                    meeting, and mark the meeting Ended.
 *
 * Unlike the live runtime there is no rolling cadence: an import only needs the
 * final pass, which reads ALL persisted spans. Progress is reported to the
 * renderer via the injected sender on the 'import:progress' channel.
 *
 * The controller takes only injected dependencies (no Electron import) so it has
 * a real unit-test surface. The buildAsr / buildExtraction factories default to
 * the real provider factory; tests inject fakes.
 */

import { randomUUID } from 'node:crypto'

import type { ASRProvider, Clock, ExtractionProvider } from '@shared/providers'

import type { IpcSender } from '../audio/AudioCaptureBridge'
import type { actionRepo } from '../db/repos/actionRepo'
import type { agendaItemRepo } from '../db/repos/agendaItemRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'
import type { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import type { meetingRepo } from '../db/repos/meetingRepo'
import type { participantRepo } from '../db/repos/participantRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'
import { ExtractionSession } from '../services/extractionSession'
import { persistInferredContext } from '../services/inferredContextPersistence'
import { MeetingLifecycleService } from '../services/meetingLifecycleService'
import { tryBuildAsrProvider, tryBuildExtractionProvider } from '../settings/providerFactory'
import type { SecretStorage } from '../settings/SecretStorage'
import type { SettingsStore } from '../settings/SettingsStore'

import { finalizeMeetingEnd } from './finalizeMeetingEnd'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportProgressStage = 'transcribing' | 'inferring' | 'extracting' | 'done' | 'error'

export interface ImportStartOptions {
  meetingId: string
  title: string
  primaryLanguage: string
  /** Agenda items the user typed; empty when inferring. */
  agendaItems: { title: string; topic: string }[]
  /** Participants the user typed; empty when inferring. */
  participants: { name: string }[]
  /** When true, infer agenda + participants from the transcript before the final pass. */
  inferContext: boolean
}

export interface ImportSessionControllerDeps {
  settingsStore: SettingsStore
  secretStorage: SecretStorage
  meetingRepo: ReturnType<typeof meetingRepo>
  agendaItemRepo: ReturnType<typeof agendaItemRepo>
  participantRepo: ReturnType<typeof participantRepo>
  transcriptSpanRepo: ReturnType<typeof transcriptSpanRepo>
  decisionRepo: ReturnType<typeof decisionRepo>
  actionRepo: ReturnType<typeof actionRepo>
  discussionSummaryRepo: ReturnType<typeof discussionSummaryRepo>
  sender: IpcSender
  clock: Clock
  /** Injected so tests can supply fake providers. Defaults to the real factory. */
  buildAsr?: typeof tryBuildAsrProvider
  /** Injected so tests can supply fake providers. Defaults to the real factory. */
  buildExtraction?: typeof tryBuildExtractionProvider
  /**
   * The single enforcer of Live → Ended. Optional so tests get one built from
   * meetingRepo + clock; production injects the shared instance.
   */
  meetingLifecycle?: MeetingLifecycleService
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ImportSessionController {
  private readonly _settingsStore: SettingsStore
  private readonly _secretStorage: SecretStorage
  private readonly _meetingRepo: ReturnType<typeof meetingRepo>
  private readonly _agendaRepo: ReturnType<typeof agendaItemRepo>
  private readonly _participantRepo: ReturnType<typeof participantRepo>
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _decisionRepo: ReturnType<typeof decisionRepo>
  private readonly _actionRepo: ReturnType<typeof actionRepo>
  private readonly _dsRepo: ReturnType<typeof discussionSummaryRepo>
  private readonly _sender: IpcSender
  private readonly _clock: Clock
  private readonly _buildAsr: typeof tryBuildAsrProvider
  private readonly _buildExtraction: typeof tryBuildExtractionProvider
  private readonly _meetingLifecycle: MeetingLifecycleService

  private _asrProvider: ASRProvider | null = null
  /** Decoded PCM frames accumulated from the renderer, transcribed in one batch on finish. */
  private _pcmChunks: Uint8Array[] = []
  private _opts: ImportStartOptions | null = null

  constructor(deps: ImportSessionControllerDeps) {
    this._settingsStore = deps.settingsStore
    this._secretStorage = deps.secretStorage
    this._meetingRepo = deps.meetingRepo
    this._agendaRepo = deps.agendaItemRepo
    this._participantRepo = deps.participantRepo
    this._spanRepo = deps.transcriptSpanRepo
    this._decisionRepo = deps.decisionRepo
    this._actionRepo = deps.actionRepo
    this._dsRepo = deps.discussionSummaryRepo
    this._sender = deps.sender
    this._clock = deps.clock
    this._buildAsr = deps.buildAsr ?? tryBuildAsrProvider
    this._buildExtraction = deps.buildExtraction ?? tryBuildExtractionProvider
    this._meetingLifecycle =
      deps.meetingLifecycle ?? new MeetingLifecycleService(deps.meetingRepo, deps.clock)
  }

  /**
   * Begin an import: persist the meeting + user context and build the ASR
   * provider. Decoded PCM frames are accumulated (not streamed) and transcribed
   * in one batch on finish(), so cloud providers use their prerecorded API and
   * none of the realtime socket timing applies. If the ASR provider is not
   * configured, emits an 'error' progress event and does not transcribe.
   */
  start(opts: ImportStartOptions): void {
    this._opts = opts
    this._pcmChunks = []

    const now = new Date(this._clock.now()).toISOString()
    if (this._meetingRepo.findById(opts.meetingId) === null) {
      this._meetingRepo.insert({
        id: opts.meetingId,
        title: opts.title,
        state: 'live',
        source: 'import',
        paused: false,
        createdAt: now,
        startedAt: now,
        primaryLanguage: opts.primaryLanguage,
        titleAutoGenerated: false,
      })
    }

    // Persist any user-supplied agenda items + participants (assign IDs).
    for (const item of opts.agendaItems) {
      this._agendaRepo.insert(
        { id: randomUUID(), title: item.title, topic: item.topic, state: 'confirmed' },
        opts.meetingId,
      )
    }
    for (const p of opts.participants) {
      this._participantRepo.insert({ id: randomUUID(), name: p.name }, opts.meetingId)
    }

    const asrResult = this._buildAsr(this._settingsStore.current, this._secretStorage, 'import')
    if (!asrResult.ok) {
      this._emitProgress('error', { error: asrResult.error })
      this._asrProvider = null
      return
    }

    this._asrProvider = asrResult.provider
    this._emitProgress('transcribing')
  }

  /** Accumulate a decoded PCM frame for the batch transcription. No-op when not started. */
  pushFrame(frame: Uint8Array): void {
    if (this._asrProvider === null) return
    this._pcmChunks.push(frame)
  }

  /**
   * Finish the import: transcribe the accumulated audio in one batch, persist the
   * spans, optionally infer context, run the final extraction pass, mark the
   * meeting Ended, and resolve with its id. A transcription failure emits an
   * 'error' stage and stops (no notes, meeting not ended) so the renderer can
   * react instead of silently producing an empty meeting.
   */
  async finish(meetingId: string): Promise<{ meetingId: string }> {
    const opts = this._opts
    const asrProvider = this._asrProvider
    this._asrProvider = null

    // start() already emitted 'error' when the ASR provider was not configured.
    if (asrProvider === null) return { meetingId }

    if (asrProvider.transcribeBatch === undefined) {
      this._emitProgress('error', { error: 'ASR provider does not support file import' })
      return { meetingId }
    }

    // Transcribe the whole decoded buffer in one shot (prerecorded for cloud,
    // chunked inference for local — no realtime socket either way).
    const pcm = this._concatPcm()
    this._pcmChunks = []
    try {
      const spans = await asrProvider.transcribeBatch(pcm)
      for (const span of spans) {
        if (span.isFinal === false) continue
        this._spanRepo.insert(span, meetingId)
      }
    } catch (err) {
      console.error(
        '[ImportSessionController] Transcription failed:',
        err instanceof Error ? err.message : 'unknown error',
      )
      this._emitProgress('error', { error: 'transcription failed' })
      return { meetingId }
    }

    const extractionResult = this._buildExtraction(this._settingsStore.current, this._secretStorage)
    const extractionProvider = extractionResult.ok ? extractionResult.provider : null

    // Optionally infer the agenda + participants from the transcript. Best-effort:
    // a transient provider failure (429, timeout, expired key) must NOT strand the
    // import at finalisation. Degrade to no inferred context — the final pass below
    // still runs and the meeting still transitions to Ended (audit C2). Mirrors the
    // guard in LiveExtractionRuntime.endMeeting.
    if (opts?.inferContext === true && extractionProvider?.inferContext !== undefined) {
      this._emitProgress('inferring')
      try {
        await this._inferAndPersistContext(extractionProvider, meetingId)
      } catch (err) {
        console.error(
          '[ImportSessionController] context inference failed, ' +
            'continuing with the final pass without inferred context:',
          err instanceof Error ? err.message : 'unknown error',
        )
      }
    }

    // Run the same final pass as a live meeting (reads ALL persisted spans).
    this._emitProgress('extracting')
    await this._runFinalPass(extractionProvider, meetingId)

    // Mark the meeting Ended through the single enforcer (Live → Ended); the
    // import row is inserted Live in start(), so it transitions here.
    finalizeMeetingEnd(this._meetingRepo, this._meetingLifecycle, meetingId)

    this._emitProgress('done')
    return { meetingId }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Concatenate the accumulated PCM frames into one contiguous buffer. */
  private _concatPcm(): Uint8Array {
    const total = this._pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const pcm = new Uint8Array(total)
    let offset = 0
    for (const chunk of this._pcmChunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    return pcm
  }

  /** Infer agenda + participants from the transcript and persist them. */
  private async _inferAndPersistContext(
    provider: ExtractionProvider,
    meetingId: string,
  ): Promise<void> {
    if (provider.inferContext === undefined) return
    const spans = this._spanRepo.listByMeeting(meetingId)
    if (spans.length === 0) return

    const inferred = await provider.inferContext({ source: { spans } })
    // Import-inferred agenda items are Proposed: the user never confirmed them
    // (ADR 0029). User-supplied import items stay Confirmed (see start()). Same
    // rule as the live final pass, via the shared helper.
    persistInferredContext(
      { agendaItemRepo: this._agendaRepo, participantRepo: this._participantRepo },
      meetingId,
      inferred,
    )
  }

  /**
   * Run the final extraction pass via the shared ExtractionSession core so
   * summaries and proposed items are produced and persisted exactly as for a live
   * meeting (audit A3). Import composes the core directly rather than building a
   * whole live runtime — none of the live-only concerns (rolling cadence, agenda
   * scheduler, running summary) apply here. No agendaItemRepo is wired, so the
   * end-of-meeting agenda:changed push is skipped; Review reads the agenda via
   * meeting:load instead. When no extraction provider is configured the meeting
   * degrades to no notes (finish() still marks it Ended).
   */
  private async _runFinalPass(
    provider: ExtractionProvider | null,
    meetingId: string,
  ): Promise<void> {
    const meeting = this._meetingRepo.findById(meetingId)
    if (meeting === null) return

    const context = {
      agendaItems: this._agendaRepo.listByMeeting(meetingId),
      participants: this._participantRepo.listByMeeting(meetingId),
      primaryLanguage: meeting.primaryLanguage,
    }

    if (provider === null) {
      console.warn(
        '[ImportSessionController] No extraction provider configured. ' +
          'The imported meeting will have no notes. ' +
          'Configure an extraction API key in Settings to enable item extraction.',
      )
      return
    }

    const core = new ExtractionSession({
      meetingId,
      sender: this._sender,
      provider,
      clock: this._clock,
      decisionsRepo: this._decisionRepo,
      actionsRepo: this._actionRepo,
      spanRepo: this._spanRepo,
      dsRepo: this._dsRepo,
      getContext: () => context,
    })

    await core.runFinalPass(meeting, context)
  }

  private _emitProgress(stage: ImportProgressStage, extra?: { error: string }): void {
    this._sender.send('import:progress', { stage, ...extra })
  }
}
