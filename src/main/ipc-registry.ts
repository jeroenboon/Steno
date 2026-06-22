/**
 * Pure IPC handler registry for the main process.
 *
 * createIpcRegistry() returns a registry with a dispatch() method. All IPC
 * payloads are validated with Zod before reaching the handler. Unknown channels
 * are rejected at runtime, not silently swallowed.
 *
 * This is a pure function (no Electron imports) so it can be unit-tested
 * without launching Electron.
 *
 * ## Handler injection (added in item 0012)
 *
 * Handlers that depend on stateful services (SettingsStore, SecretStorage) are
 * injected at registry creation time via IpcRegistryDependencies. This keeps
 * the registry itself pure and testable while allowing the real services to be
 * wired in src/main/index.ts.
 */

import { randomUUID } from 'crypto'

import {
  PingRequestSchema,
  PingResponseSchema,
  SettingsGetRequestSchema,
  SettingsSetRequestSchema,
  SettingsSetResponseSchema,
  EgressStateGetRequestSchema,
  SecretSetRequestSchema,
  SecretSetResponseSchema,
  SecretHasRequestSchema,
  SecretHasResponseSchema,
  MeetingCreateRequestSchema,
  MeetingCreateResponseSchema,
  AgendaItemAddRequestSchema,
  AgendaItemAddResponseSchema,
  AgendaItemRemoveRequestSchema,
  AgendaItemRemoveResponseSchema,
  ParticipantAddRequestSchema,
  ParticipantAddResponseSchema,
  ParticipantRemoveRequestSchema,
  ParticipantRemoveResponseSchema,
  MeetingStartRequestSchema,
  MeetingStartResponseSchema,
  AudioStartRequestSchema,
  AudioStartResponseSchema,
  AudioStopRequestSchema,
  AudioStopResponseSchema,
  ItemConfirmRequestSchema,
  ItemEditAndConfirmRequestSchema,
  ItemDismissRequestSchema,
  ItemDismissResponseSchema,
  ItemCreateConfirmedRequestSchema,
  SummaryQueryRequestSchema,
  SummaryQueryResponseSchema,
  MeetingEndRequestSchema,
  MeetingEndResponseSchema,
  ExportMarkdownRequestSchema,
  ExportCopyMarkdownRequestSchema,
  ExportCopyMarkdownResponseSchema,
  TranscriptCopyRequestSchema,
  TranscriptCopyResponseSchema,
  MeetingListRequestSchema,
  MeetingListResponseSchema,
  MeetingLoadRequestSchema,
  MeetingLoadResponseSchema,
  MeetingDeleteRequestSchema,
  MeetingDeleteResponseSchema,
  ModelStatusRequestSchema,
  ModelStatusResponseSchema,
  ModelDownloadRequestSchema,
  ModelDownloadResponseSchema,
  ImportStartRequestSchema,
  ImportStartResponseSchema,
  ImportFinishRequestSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  PingResponse,
  SettingsGetResponse,
  SettingsSetResponse,
  EgressState,
  SecretSetResponse,
  SecretHasResponse,
  MeetingCreateResponse,
  AgendaItemAddResponse,
  AgendaItemRemoveResponse,
  ParticipantAddResponse,
  ParticipantRemoveResponse,
  MeetingStartResponse,
  AudioStartResponse,
  AudioStopResponse,
  ItemConfirmResponse,
  ItemEditAndConfirmResponse,
  ItemDismissResponse,
  ItemCreateConfirmedResponse,
  SummaryQueryResponse,
  MeetingEndResponse,
  ExportMarkdownResponse,
  ExportCopyMarkdownResponse,
  TranscriptCopyResponse,
  MeetingListResponse,
  MeetingLoadResponse,
  MeetingDeleteResponse,
  ModelStatusResponse,
  ModelDownloadResponse,
  ModelProgressEvent,
  ImportStartRequest,
  ImportStartResponse,
  ImportFinishResponse,
} from '@shared/ipc'
import type { Clock } from '@shared/providers'

import type { AudioCaptureBridge } from './audio/AudioCaptureBridge'
import type { ModelDownloader } from './providers/sherpa/ModelDownloader'
import type { ItemLifecycleService } from './services/itemLifecycleService'
import { computeEgressState } from './settings/egressState'
import type { SecretStorage } from './settings/SecretStorage'
import type { SettingsStore } from './settings/SettingsStore'

// A handler takes an unknown payload, validates it, and returns the result.
// The return is unknown at the type level; runtime callers use Promise.resolve() on it.
type Handler = (raw: unknown) => unknown

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface IpcRegistryDependencies {
  /** Loaded SettingsStore instance. Must have load() already called. */
  settingsStore: SettingsStore
  /**
   * SecretStorage instance (item 0016).
   * Handles API keys via safeStorage in production, MemorySecretStorage in tests.
   * Optional for backwards compat with tests that don't exercise secret channels.
   */
  secretStorage?: SecretStorage
  /** Database instance (optional, for future persistence). */
  db?: unknown
  /** Clock for generating timestamps. */
  clock?: Clock
  /**
   * Audio capture bridge (item 0015).
   * Optional: when absent, audio:start / audio:stop return ok but are no-ops.
   * Injected in production after the window is created.
   */
  audioBridge?: AudioCaptureBridge
  /**
   * Called after audio:start succeeds (item 0018).
   * Use to spin up the LiveExtractionRuntime for the active session.
   * Receives the real Meeting id the renderer is recording against.
   */
  onAudioStart?: (meetingId: string) => void
  /**
   * Called after audio:stop succeeds (item 0018).
   * Use to tear down the LiveExtractionRuntime.
   */
  onAudioStop?: () => void
  /**
   * ItemLifecycleService instance (item 0018).
   * Required for item:confirm, item:editAndConfirm, item:dismiss, item:createConfirmed.
   * When absent, those channels return a "not available" error (graceful degradation).
   */
  itemLifecycleService?: ItemLifecycleService
  /**
   * Active meeting ID (item 0018).
   * Used by item:createConfirmed to scope the new item to the correct meeting.
   */
  activeMeetingId?: () => string | null
  /**
   * Query the running summary with a free-form question (item 0020).
   * Called when the note-taker submits a question in the RunningSum panel.
   * Returns '' when the active runtime has no provider or no query capability.
   */
  summaryQuery?: (question: string) => Promise<string>
  /**
   * Called when the note-taker ends the meeting (item 0021).
   * Main calls endMeeting() on the active LiveExtractionRuntime, which
   * triggers the final extraction pass, emits items:summaries, and stops.
   * When absent, meeting:end is a no-op (graceful degradation).
   */
  onMeetingEnd?: (meetingId: string) => Promise<void>
  /**
   * Save content to a file the user selects via a save dialog (item 0022).
   * Returns ok=false with a reason if the dialog is cancelled or the write fails.
   * When absent, returns ok=false with reason 'not available'.
   */
  onExportFile?: (opts: {
    content: string
    defaultFilename: string
    filters: { name: string; extensions: string[] }[]
  }) => Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * Copy content to the clipboard (item 0022).
   * When absent, is a no-op.
   */
  onCopyToClipboard?: (content: string) => void
  /**
   * Copy a meeting's full transcript to the clipboard (item 0026).
   * Main reads the persisted spans, serialises them, and copies the text.
   * When absent, transcript:copy is a no-op (still returns ok).
   */
  onCopyTranscript?: (meetingId: string) => void
  /**
   * List all meetings ordered newest-first (item 0023).
   * When absent, returns an empty list.
   */
  meetingList?: () => MeetingListResponse['meetings']
  /**
   * Load full state of a past meeting (item 0023).
   * Returns null when the meeting is not found.
   * When absent, always returns null.
   */
  meetingLoad?: (meetingId: string) => MeetingLoadResponse | null
  /**
   * Delete a meeting and all its data (item 0026).
   * When absent, meeting:delete is a no-op (still returns ok).
   */
  meetingDelete?: (meetingId: string) => void
  /**
   * ModelDownloader for the local ASR model (item 0024).
   * When absent, model:status always returns downloaded: false and
   * model:download returns an error.
   */
  modelDownloader?: ModelDownloader
  /**
   * Callback to push model:progress events to the renderer (item 0024).
   * Injected in production from main/index.ts via webContents.send.
   */
  pushModelProgress?: (evt: ModelProgressEvent) => void
  /**
   * Start an audio-file import (item 0026). Generates the meeting id, starts the
   * ImportSessionController, and returns the new meeting id. When absent,
   * import:start throws "not available".
   */
  onImportStart?: (req: ImportStartRequest) => string
  /**
   * Finish the active import (item 0026): stop transcription, infer (if asked),
   * run the final pass, mark the meeting Ended. Resolves with the meeting id.
   * When absent, import:finish throws "not available".
   */
  onImportFinish?: (meetingId: string) => Promise<ImportFinishResponse>
}

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

// The dispatch signature is typed over the known channel union so callers get
// type-safe autocomplete, while the runtime guard catches anything that slips
// through (e.g. from untyped IPC events coming off the wire).
export interface IpcRegistry {
  dispatch: (channel: IpcChannel, payload: unknown) => Promise<unknown>
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handlePing(raw: unknown): PingResponse {
  PingRequestSchema.parse(raw)
  return PingResponseSchema.parse({ pong: true })
}

function makeHandleSettingsGet(deps: IpcRegistryDependencies) {
  return function handleSettingsGet(raw: unknown): SettingsGetResponse {
    SettingsGetRequestSchema.parse(raw)
    return deps.settingsStore.current
  }
}

function makeHandleSettingsSet(deps: IpcRegistryDependencies) {
  return async function handleSettingsSet(raw: unknown): Promise<SettingsSetResponse> {
    const settings = SettingsSetRequestSchema.parse(raw)
    await deps.settingsStore.save(settings)
    return SettingsSetResponseSchema.parse({ ok: true })
  }
}

function makeHandleEgressState(deps: IpcRegistryDependencies) {
  return function handleEgressState(raw: unknown): EgressState {
    EgressStateGetRequestSchema.parse(raw)
    return computeEgressState(deps.settingsStore.current)
  }
}

function makeHandleMeetingCreate(deps: IpcRegistryDependencies) {
  return function handleMeetingCreate(raw: unknown): MeetingCreateResponse {
    const req = MeetingCreateRequestSchema.parse(raw)

    const now = new Date(deps.clock?.now() ?? Date.now()).toISOString()
    const meeting: MeetingCreateResponse = {
      id: randomUUID(),
      title: req.title,
      state: 'draft',
      source: 'live',
      paused: false,
      createdAt: now,
      primaryLanguage: req.primaryLanguage,
    }

    return MeetingCreateResponseSchema.parse(meeting)
  }
}

function makeHandleAgendaItemAdd(): (raw: unknown) => AgendaItemAddResponse {
  return function handleAgendaItemAdd(raw: unknown): AgendaItemAddResponse {
    const req = AgendaItemAddRequestSchema.parse(raw)

    const agendaItem: AgendaItemAddResponse = {
      id: randomUUID(),
      title: req.title,
      topic: req.topic,
    }

    return AgendaItemAddResponseSchema.parse(agendaItem)
  }
}

function makeHandleAgendaItemRemove(): (raw: unknown) => AgendaItemRemoveResponse {
  return function handleAgendaItemRemove(raw: unknown): AgendaItemRemoveResponse {
    AgendaItemRemoveRequestSchema.parse(raw)
    return AgendaItemRemoveResponseSchema.parse({ ok: true })
  }
}

function makeHandleParticipantAdd(): (raw: unknown) => ParticipantAddResponse {
  return function handleParticipantAdd(raw: unknown): ParticipantAddResponse {
    const req = ParticipantAddRequestSchema.parse(raw)

    const participant: ParticipantAddResponse = {
      id: randomUUID(),
      name: req.name,
    }

    return ParticipantAddResponseSchema.parse(participant)
  }
}

function makeHandleParticipantRemove(): (raw: unknown) => ParticipantRemoveResponse {
  return function handleParticipantRemove(raw: unknown): ParticipantRemoveResponse {
    ParticipantRemoveRequestSchema.parse(raw)
    return ParticipantRemoveResponseSchema.parse({ ok: true })
  }
}

function makeHandleMeetingStart(deps: IpcRegistryDependencies) {
  return function handleMeetingStart(raw: unknown): MeetingStartResponse {
    const req = MeetingStartRequestSchema.parse(raw)

    const now = new Date(deps.clock?.now() ?? Date.now()).toISOString()

    // For now, return a live meeting. When integrated with the DB + service,
    // this will load the meeting, validate it, and persist the transition.
    const meeting: MeetingStartResponse = {
      id: req.meetingId,
      title: 'Meeting',
      state: 'live',
      source: 'live',
      paused: false,
      createdAt: now,
      primaryLanguage: 'nl',
      startedAt: now,
    }

    return MeetingStartResponseSchema.parse(meeting)
  }
}

function makeHandleSecretSet(deps: IpcRegistryDependencies) {
  return function handleSecretSet(raw: unknown): SecretSetResponse {
    const req = SecretSetRequestSchema.parse(raw)
    if (deps.secretStorage === undefined) {
      throw new Error('SecretStorage is not available')
    }
    deps.secretStorage.setSecret(req.key, req.value)
    return SecretSetResponseSchema.parse({ ok: true })
  }
}

function makeHandleSecretHas(deps: IpcRegistryDependencies) {
  return function handleSecretHas(raw: unknown): SecretHasResponse {
    const req = SecretHasRequestSchema.parse(raw)
    if (deps.secretStorage === undefined) {
      return SecretHasResponseSchema.parse({ has: false })
    }
    const has = deps.secretStorage.getSecret(req.key) !== null
    return SecretHasResponseSchema.parse({ has })
  }
}

function makeHandleAudioStart(deps: IpcRegistryDependencies) {
  return function handleAudioStart(raw: unknown): AudioStartResponse {
    const req = AudioStartRequestSchema.parse(raw)
    deps.audioBridge?.start()
    deps.onAudioStart?.(req.meetingId)
    return AudioStartResponseSchema.parse({ ok: true })
  }
}

function makeHandleAudioStop(deps: IpcRegistryDependencies) {
  return function handleAudioStop(raw: unknown): AudioStopResponse {
    AudioStopRequestSchema.parse(raw)
    deps.audioBridge?.stop()
    deps.onAudioStop?.()
    return AudioStopResponseSchema.parse({ ok: true })
  }
}

// ---------------------------------------------------------------------------
// Item action handlers (item 0018)
// ---------------------------------------------------------------------------

function makeHandleItemConfirm(deps: IpcRegistryDependencies) {
  return function handleItemConfirm(raw: unknown): ItemConfirmResponse {
    const req = ItemConfirmRequestSchema.parse(raw)
    if (deps.itemLifecycleService === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    return deps.itemLifecycleService.confirm({ kind: req.kind, id: req.id })
  }
}

function makeHandleItemEditAndConfirm(deps: IpcRegistryDependencies) {
  return function handleItemEditAndConfirm(raw: unknown): ItemEditAndConfirmResponse {
    const req = ItemEditAndConfirmRequestSchema.parse(raw)
    if (deps.itemLifecycleService === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    if (req.kind === 'decision') {
      // Rebuild with only defined keys: under exactOptionalPropertyTypes a
      // value of `string | undefined` is not assignable to an optional `string`.
      const updates: Parameters<typeof deps.itemLifecycleService.editAndConfirmDecision>[1] = {}
      if (req.updates.rationale !== undefined) updates.rationale = req.updates.rationale
      if (req.updates.agendaItemId !== undefined) updates.agendaItemId = req.updates.agendaItemId
      return deps.itemLifecycleService.editAndConfirmDecision(req.id, updates)
    } else {
      const updates: Parameters<typeof deps.itemLifecycleService.editAndConfirmAction>[1] = {}
      if (req.updates.status !== undefined) updates.status = req.updates.status
      if (req.updates.agendaItemId !== undefined) updates.agendaItemId = req.updates.agendaItemId
      if (req.updates.owner !== undefined) updates.owner = req.updates.owner
      if (req.updates.dueDate !== undefined) updates.dueDate = req.updates.dueDate
      return deps.itemLifecycleService.editAndConfirmAction(req.id, updates)
    }
  }
}

function makeHandleItemDismiss(deps: IpcRegistryDependencies) {
  return function handleItemDismiss(raw: unknown): ItemDismissResponse {
    const req = ItemDismissRequestSchema.parse(raw)
    if (deps.itemLifecycleService === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    deps.itemLifecycleService.dismiss({ kind: req.kind, id: req.id })
    return ItemDismissResponseSchema.parse({ ok: true })
  }
}

function makeHandleItemCreateConfirmed(deps: IpcRegistryDependencies) {
  return function handleItemCreateConfirmed(raw: unknown): ItemCreateConfirmedResponse {
    const req = ItemCreateConfirmedRequestSchema.parse(raw)
    if (deps.itemLifecycleService === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    if (req.kind === 'decision') {
      return deps.itemLifecycleService.createConfirmedDecision(req.meetingId, req.item)
    } else {
      return deps.itemLifecycleService.createConfirmedAction(req.meetingId, req.item)
    }
  }
}

function makeHandleSummaryQuery(deps: IpcRegistryDependencies) {
  return async function handleSummaryQuery(raw: unknown): Promise<SummaryQueryResponse> {
    const req = SummaryQueryRequestSchema.parse(raw)
    const answer = deps.summaryQuery !== undefined ? await deps.summaryQuery(req.question) : ''
    return SummaryQueryResponseSchema.parse({ answer })
  }
}

function makeHandleMeetingEnd(deps: IpcRegistryDependencies) {
  return async function handleMeetingEnd(raw: unknown): Promise<MeetingEndResponse> {
    const req = MeetingEndRequestSchema.parse(raw)
    if (deps.onMeetingEnd !== undefined) {
      await deps.onMeetingEnd(req.meetingId)
    }
    return MeetingEndResponseSchema.parse({ ok: true })
  }
}

function makeHandleExportMarkdown(deps: IpcRegistryDependencies) {
  return async function handleExportMarkdown(raw: unknown): Promise<ExportMarkdownResponse> {
    const req = ExportMarkdownRequestSchema.parse(raw)
    if (deps.onExportFile === undefined) {
      return { ok: false, reason: 'not available' }
    }
    return deps.onExportFile({
      content: req.content,
      defaultFilename: 'notulen.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
  }
}

function makeHandleExportCopyMarkdown(deps: IpcRegistryDependencies) {
  return function handleExportCopyMarkdown(raw: unknown): ExportCopyMarkdownResponse {
    const req = ExportCopyMarkdownRequestSchema.parse(raw)
    deps.onCopyToClipboard?.(req.content)
    return ExportCopyMarkdownResponseSchema.parse({ ok: true })
  }
}

function makeHandleTranscriptCopy(deps: IpcRegistryDependencies) {
  return function handleTranscriptCopy(raw: unknown): TranscriptCopyResponse {
    const req = TranscriptCopyRequestSchema.parse(raw)
    deps.onCopyTranscript?.(req.meetingId)
    return TranscriptCopyResponseSchema.parse({ ok: true })
  }
}

function makeHandleMeetingList(deps: IpcRegistryDependencies) {
  return function handleMeetingList(raw: unknown): MeetingListResponse {
    MeetingListRequestSchema.parse(raw)
    const meetings = deps.meetingList?.() ?? []
    return MeetingListResponseSchema.parse({ meetings })
  }
}

function makeHandleMeetingLoad(deps: IpcRegistryDependencies) {
  return function handleMeetingLoad(raw: unknown): MeetingLoadResponse {
    const req = MeetingLoadRequestSchema.parse(raw)
    if (deps.meetingLoad === undefined) {
      throw new Error('meeting:load is not available')
    }
    const result = deps.meetingLoad(req.meetingId)
    if (result === null) {
      throw new Error(`Meeting not found: ${req.meetingId}`)
    }
    return MeetingLoadResponseSchema.parse(result)
  }
}

function makeHandleMeetingDelete(deps: IpcRegistryDependencies) {
  return function handleMeetingDelete(raw: unknown): MeetingDeleteResponse {
    const req = MeetingDeleteRequestSchema.parse(raw)
    deps.meetingDelete?.(req.meetingId)
    return MeetingDeleteResponseSchema.parse({ ok: true })
  }
}

function makeHandleModelStatus(deps: IpcRegistryDependencies) {
  return function handleModelStatus(raw: unknown): ModelStatusResponse {
    const req = ModelStatusRequestSchema.parse(raw)
    const downloaded = deps.modelDownloader?.isDownloaded() ?? false
    return ModelStatusResponseSchema.parse({
      modelId: req.modelId,
      downloaded,
      sizeBytes: 0,
    })
  }
}

function makeHandleModelDownload(deps: IpcRegistryDependencies) {
  return function handleModelDownload(raw: unknown): ModelDownloadResponse {
    const req = ModelDownloadRequestSchema.parse(raw)

    if (deps.modelDownloader === undefined || deps.pushModelProgress === undefined) {
      throw new Error('model:download is not available — ModelDownloader not configured')
    }

    const downloader = deps.modelDownloader
    const push = deps.pushModelProgress
    const modelId = req.modelId

    void downloader
      .download((received, total) => {
        push({ modelId, bytesReceived: received, bytesTotal: total, done: false })
      })
      .then(() => {
        push({ modelId, bytesReceived: 0, bytesTotal: 0, done: true })
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err)
        push({ modelId, bytesReceived: 0, bytesTotal: 0, done: true, error })
      })

    return ModelDownloadResponseSchema.parse({ ok: true })
  }
}

function makeHandleImportStart(deps: IpcRegistryDependencies) {
  return function handleImportStart(raw: unknown): ImportStartResponse {
    const req = ImportStartRequestSchema.parse(raw)
    if (deps.onImportStart === undefined) {
      throw new Error('import:start is not available')
    }
    const meetingId = deps.onImportStart(req)
    return ImportStartResponseSchema.parse({ meetingId })
  }
}

function makeHandleImportFinish(deps: IpcRegistryDependencies) {
  return async function handleImportFinish(raw: unknown): Promise<ImportFinishResponse> {
    const req = ImportFinishRequestSchema.parse(raw)
    if (deps.onImportFinish === undefined) {
      throw new Error('import:finish is not available')
    }
    return deps.onImportFinish(req.meetingId)
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createIpcRegistry(deps: IpcRegistryDependencies): IpcRegistry {
  // Typed as a partial map so that unknown channels yield undefined at runtime.
  const HANDLERS: Partial<Record<IpcChannel, Handler>> = {
    ping: handlePing,
    'settings:get': makeHandleSettingsGet(deps),
    'settings:set': makeHandleSettingsSet(deps),
    'egress:state': makeHandleEgressState(deps),
    'secret:set': makeHandleSecretSet(deps),
    'secret:has': makeHandleSecretHas(deps),
    'meeting:create': makeHandleMeetingCreate(deps),
    'agendaItem:add': makeHandleAgendaItemAdd(),
    'agendaItem:remove': makeHandleAgendaItemRemove(),
    'participant:add': makeHandleParticipantAdd(),
    'participant:remove': makeHandleParticipantRemove(),
    'meeting:start': makeHandleMeetingStart(deps),
    'audio:start': makeHandleAudioStart(deps),
    'audio:stop': makeHandleAudioStop(deps),
    'item:confirm': makeHandleItemConfirm(deps),
    'item:editAndConfirm': makeHandleItemEditAndConfirm(deps),
    'item:dismiss': makeHandleItemDismiss(deps),
    'item:createConfirmed': makeHandleItemCreateConfirmed(deps),
    'summary:query': makeHandleSummaryQuery(deps),
    'meeting:end': makeHandleMeetingEnd(deps),
    'export:markdown': makeHandleExportMarkdown(deps),
    'export:copyMarkdown': makeHandleExportCopyMarkdown(deps),
    'transcript:copy': makeHandleTranscriptCopy(deps),
    'meeting:list': makeHandleMeetingList(deps),
    'meeting:load': makeHandleMeetingLoad(deps),
    'meeting:delete': makeHandleMeetingDelete(deps),
    'model:status': makeHandleModelStatus(deps),
    'model:download': makeHandleModelDownload(deps),
    'import:start': makeHandleImportStart(deps),
    'import:finish': makeHandleImportFinish(deps),
  }

  return {
    dispatch(channel, payload) {
      const handler = HANDLERS[channel]
      if (handler === undefined) {
        return Promise.reject(new Error(`IPC: unknown channel "${channel}"`))
      }
      try {
        return Promise.resolve(handler(payload))
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)))
      }
    },
  }
}
