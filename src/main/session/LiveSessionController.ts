/**
 * LiveSessionController (architecture task 1).
 *
 * Owns the lifecycle of one live meeting session: build the ASR provider, build
 * the LiveExtractionRuntime, build the AudioCaptureBridge, wire spans, tear all
 * of it down, and run the final extraction pass on meeting end.
 *
 * ## Why a module?
 * This logic previously lived as closures and mutable vars (`currentBridge`,
 * `activeRuntime`, `buildRuntime`) inside `registerIpcHandlers` in index.ts. It
 * pulled in Electron (`BrowserWindow`, `webContents`) so it could not be unit
 * tested — which is exactly where the audio start/stop bugs hid. Extracting it
 * into a class with injected deps (no Electron import) gives it locality and a
 * real test surface.
 *
 * The controller takes only injected dependencies. In production index.ts wires
 * the real SettingsStore / SecretStorage / repos / `webContents` sender / clock;
 * tests pass fakes. The `buildAsr` / `buildExtraction` factory functions are
 * injected (defaulting to the real ones) so tests can feed fake providers.
 */

import { FakeASRProvider } from '@shared/providers'
import type { Clock } from '@shared/providers'

import { AudioCaptureBridge, type IpcSender } from '../audio/AudioCaptureBridge'
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

const CADENCE_MS = 20_000

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface LiveSessionControllerDeps {
  settingsStore: SettingsStore
  secretStorage: SecretStorage
  decisionRepo: ReturnType<typeof decisionRepo>
  actionRepo: ReturnType<typeof actionRepo>
  transcriptSpanRepo: ReturnType<typeof transcriptSpanRepo>
  discussionSummaryRepo: ReturnType<typeof discussionSummaryRepo>
  meetingRepo: ReturnType<typeof meetingRepo>
  agendaItemRepo: ReturnType<typeof agendaItemRepo>
  participantRepo: ReturnType<typeof participantRepo>
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

export class LiveSessionController {
  private readonly _settingsStore: SettingsStore
  private readonly _secretStorage: SecretStorage
  private readonly _decisionRepo: ReturnType<typeof decisionRepo>
  private readonly _actionRepo: ReturnType<typeof actionRepo>
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _dsRepo: ReturnType<typeof discussionSummaryRepo>
  private readonly _meetingRepo: ReturnType<typeof meetingRepo>
  private readonly _agendaItemRepo: ReturnType<typeof agendaItemRepo>
  private readonly _participantRepo: ReturnType<typeof participantRepo>
  private readonly _sender: IpcSender
  private readonly _clock: Clock
  private readonly _buildAsr: typeof tryBuildAsrProvider
  private readonly _buildExtraction: typeof tryBuildExtractionProvider

  private _currentBridge: AudioCaptureBridge | null = null
  private _activeRuntime: LiveExtractionRuntime | null = null

  constructor(deps: LiveSessionControllerDeps) {
    this._settingsStore = deps.settingsStore
    this._secretStorage = deps.secretStorage
    this._decisionRepo = deps.decisionRepo
    this._actionRepo = deps.actionRepo
    this._spanRepo = deps.transcriptSpanRepo
    this._dsRepo = deps.discussionSummaryRepo
    this._meetingRepo = deps.meetingRepo
    this._agendaItemRepo = deps.agendaItemRepo
    this._participantRepo = deps.participantRepo
    this._sender = deps.sender
    this._clock = deps.clock
    this._buildAsr = deps.buildAsr ?? tryBuildAsrProvider
    this._buildExtraction = deps.buildExtraction ?? tryBuildExtractionProvider
  }

  /**
   * Start a live session. Stops any running session first, rebuilds the ASR
   * provider from the settings active RIGHT NOW (so a model downloaded or a
   * provider switched after app startup is picked up without a restart), builds
   * the runtime and bridge, and starts the bridge.
   */
  start(meetingId: string): void {
    // Stop any running bridge/runtime first.
    this._currentBridge?.stop()
    this._activeRuntime?.stop()

    const asrResult = this._buildAsr(this._settingsStore.current, this._secretStorage)
    if (!asrResult.ok) {
      console.warn(
        '[LiveTranscriber] ASR provider not ready at audio:start — ' +
          `falling back to FakeASRProvider. Reason: ${asrResult.error}`,
      )
    }
    const asrProvider = asrResult.ok ? asrResult.provider : new FakeASRProvider()

    this._activeRuntime = this._buildRuntime(meetingId)

    this._currentBridge = new AudioCaptureBridge({
      asrProvider,
      sender: this._sender,
      onSpan: (span) => {
        const runtime = this._activeRuntime
        if (runtime !== null) {
          runtime.handleSpan(span)
          // tick() is a no-op when the cadence threshold hasn't been crossed.
          void runtime.tick()
        }
      },
    })
    this._currentBridge.start()
  }

  /** Stop the active session and tear down the bridge + runtime. */
  stop(): void {
    this._currentBridge?.stop()
    this._currentBridge = null
    this._activeRuntime?.stop()
    this._activeRuntime = null
  }

  /**
   * Run the final extraction pass on the active runtime (emits items:summaries
   * and any final items:changed). Safe no-op when no runtime is active.
   *
   * `meetingId` is the row the renderer recorded against — the same id passed to
   * start() — so the final pass ends exactly that meeting.
   */
  async endMeeting(meetingId: string): Promise<void> {
    if (this._activeRuntime === null) return
    const meeting = this._meetingRepo.findById(meetingId)
    if (meeting !== null) {
      await this._activeRuntime.endMeeting(meeting)
    }
    this._activeRuntime = null
  }

  /** Answer a free-form question grounded in the active session transcript. */
  querySummary(question: string): Promise<string> {
    return this._activeRuntime !== null
      ? this._activeRuntime.querySummary(question)
      : Promise.resolve('')
  }

  /** Forward a PCM audio frame to the active bridge. No-op when not started. */
  pushAudioFrame(frame: Uint8Array): void {
    this._currentBridge?.pushAudioFrame(frame)
  }

  /** Pause the active runtime's live cadence. No-op when not started. */
  pause(): void {
    this._activeRuntime?.pause()
  }

  /** Resume the active runtime's live cadence. No-op when not started. */
  resume(): void {
    this._activeRuntime?.resume()
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _buildRuntime(meetingId: string): LiveExtractionRuntime {
    // Ensure the meeting row exists in the DB before spans reference it.
    // The renderer's meeting:create returns a UUID but does not persist a row,
    // so upsert it here (transcriptSpanRepo.insert has a foreign key on meetings).
    if (this._meetingRepo.findById(meetingId) === null) {
      this._meetingRepo.insert({
        id: meetingId,
        title: 'Active Meeting',
        state: 'live',
        source: 'live',
        paused: false,
        createdAt: new Date().toISOString(),
        primaryLanguage: this._settingsStore.current.primaryLanguage,
        startedAt: new Date().toISOString(),
        titleAutoGenerated: false,
      })
    }

    // Rebuild extraction provider from current settings so a key entered after
    // startup is picked up without restarting the app.
    const freshExtractionResult = this._buildExtraction(
      this._settingsStore.current,
      this._secretStorage,
    )
    const schedulerDeps = freshExtractionResult.ok
      ? {
          provider: freshExtractionResult.provider,
          discussionSummaryRepo: this._dsRepo,
          spanRepo: this._spanRepo,
          clock: this._clock,
          cadenceMs: CADENCE_MS,
        }
      : null

    return new LiveExtractionRuntime({
      meetingId,
      context: {
        agendaItems: [],
        participants: [],
        primaryLanguage: this._settingsStore.current.primaryLanguage,
      },
      schedulerDeps,
      decisionsRepo: this._decisionRepo,
      actionsRepo: this._actionRepo,
      spanRepo: this._spanRepo,
      dsRepo: this._dsRepo,
      agendaItemRepo: this._agendaItemRepo,
      participantRepo: this._participantRepo,
      meetingRepo: this._meetingRepo,
      sender: this._sender,
    })
  }
}
