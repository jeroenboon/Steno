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
import { LiveExtractionRuntime } from '../services/liveExtractionRuntime'
import { tryBuildAsrProvider, tryBuildExtractionProvider } from '../settings/providerFactory'
import type { SecretStorage } from '../settings/SecretStorage'
import type { SettingsStore } from '../settings/SettingsStore'

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

  private _asrProvider: ASRProvider | null = null
  private _drainDone: Promise<void> = Promise.resolve()
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
  }

  /**
   * Begin an import: persist the meeting + user context, build the ASR provider,
   * and start draining its spans into the transcript repo. If the ASR provider
   * is not configured, emits an 'error' progress event and does not transcribe.
   */
  start(opts: ImportStartOptions): void {
    this._opts = opts

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
      })
    }

    // Persist any user-supplied agenda items + participants (assign IDs).
    for (const item of opts.agendaItems) {
      this._agendaRepo.insert(
        { id: randomUUID(), title: item.title, topic: item.topic },
        opts.meetingId,
      )
    }
    for (const p of opts.participants) {
      this._participantRepo.insert({ id: randomUUID(), name: p.name }, opts.meetingId)
    }

    const asrResult = this._buildAsr(this._settingsStore.current, this._secretStorage)
    if (!asrResult.ok) {
      this._emitProgress('error', { error: asrResult.error })
      this._asrProvider = null
      return
    }

    this._asrProvider = asrResult.provider
    this._asrProvider.start()
    this._drainDone = this._drainSpans(this._asrProvider, opts.meetingId)
    this._emitProgress('transcribing')
  }

  /** Forward a decoded PCM frame to the ASR provider. No-op when not started. */
  pushFrame(frame: Uint8Array): void {
    this._asrProvider?.pushAudioFrame(frame)
  }

  /**
   * Finish the import: stop transcription, optionally infer context, run the
   * final extraction pass, mark the meeting Ended, and resolve with its id.
   */
  async finish(meetingId: string): Promise<{ meetingId: string }> {
    const opts = this._opts

    // Stop the ASR provider and wait for every span to be persisted.
    this._asrProvider?.stop()
    await this._drainDone
    this._asrProvider = null

    const extractionResult = this._buildExtraction(this._settingsStore.current, this._secretStorage)
    const provider = extractionResult.ok ? extractionResult.provider : null

    // Optionally infer the agenda + participants from the transcript.
    if (opts?.inferContext === true && provider?.inferContext !== undefined) {
      this._emitProgress('inferring')
      await this._inferAndPersistContext(provider, meetingId)
    }

    // Run the same final pass as a live meeting (reads ALL persisted spans).
    this._emitProgress('extracting')
    await this._runFinalPass(provider, meetingId)

    // Mark the meeting Ended.
    const meeting = this._meetingRepo.findById(meetingId)
    if (meeting !== null) {
      const endedAt = new Date(this._clock.now()).toISOString()
      this._meetingRepo.update({ ...meeting, state: 'ended', endedAt, updatedAt: endedAt })
    }

    this._emitProgress('done')
    return { meetingId }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Drain the ASR span iterator, persisting every final span. */
  private async _drainSpans(provider: ASRProvider, meetingId: string): Promise<void> {
    for await (const span of provider.spans()) {
      // Drop interim spans; only final spans feed persistence/extraction.
      if (span.isFinal === false) continue
      this._spanRepo.insert(span, meetingId)
    }
  }

  /** Infer agenda + participants from the transcript and persist them. */
  private async _inferAndPersistContext(
    provider: ExtractionProvider,
    meetingId: string,
  ): Promise<void> {
    if (provider.inferContext === undefined) return
    const spans = this._spanRepo.listByMeeting(meetingId)
    if (spans.length === 0) return

    const inferred = await provider.inferContext(spans)
    for (const item of inferred.agendaItems) {
      this._agendaRepo.insert({ id: randomUUID(), title: item.title, topic: item.topic }, meetingId)
    }
    for (const p of inferred.participants) {
      this._participantRepo.insert({ id: randomUUID(), name: p.name }, meetingId)
    }
  }

  /**
   * Run the final extraction pass via LiveExtractionRuntime so summaries and
   * proposed items are produced and persisted exactly as for a live meeting.
   * When no extraction provider is configured, the runtime degrades (no notes).
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

    const schedulerDeps =
      provider !== null
        ? {
            provider,
            discussionSummaryRepo: this._dsRepo,
            spanRepo: this._spanRepo,
            clock: this._clock,
          }
        : null

    const runtime = new LiveExtractionRuntime({
      meetingId,
      context,
      schedulerDeps,
      decisionsRepo: this._decisionRepo,
      actionsRepo: this._actionRepo,
      spanRepo: this._spanRepo,
      dsRepo: this._dsRepo,
      sender: this._sender,
    })

    await runtime.endMeeting(meeting)
  }

  private _emitProgress(stage: ImportProgressStage, extra?: { error: string }): void {
    this._sender.send('import:progress', { stage, ...extra })
  }
}
