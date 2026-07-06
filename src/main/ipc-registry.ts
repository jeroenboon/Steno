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
 * ## Dependency injection: grouped role interfaces (audit A2)
 *
 * Handlers that depend on stateful collaborators are injected at registry
 * creation time. Item 0012 injected them as a flat *bag of ~30 optional
 * callbacks*, which made `index.ts` wire ~30 forwarder lambdas and let this
 * surface grow unbounded. They are now grouped into a handful of narrow **role
 * interfaces** (`SessionOps`, `ItemOps`, `HistoryOps`, `ImportOps`, `ModelOps`,
 * `ProviderOps`, `PlatformOps`) that the real collaborators already satisfy, so
 * `index.ts` passes objects (`session: liveSession`) instead of lambdas.
 *
 * The registry still depends only on these **ports**, never on the concrete
 * controller classes, so fakes implement them and the registry stays unit-
 * testable without Electron (the item-0012 property). Optionality is now
 * **per-group**: a whole domain object is present or absent, and absent → that
 * domain's channels degrade exactly as the per-callback-absent case did before.
 * In production `index.ts` always wires a collaborator's full method set, so the
 * old per-method optionality was only ever a test artifact. `settingsStore`,
 * `secretStorage` and `clock` stay top-level (they are needed almost everywhere).
 * The genuinely Electron-native side effects (save dialog, clipboard,
 * `webContents.send`) live in `PlatformOps`, built in `index.ts`. See ADR 0038.
 *
 * The per-domain FILE split (this file → per-domain handler modules) is a
 * follow-up (audit A2b); this change is deps-surface only.
 */

import { randomUUID } from 'crypto'

import type { Meeting } from '@shared/domain'
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
  ProviderTestConnectionRequestSchema,
  ProviderTestConnectionResponseSchema,
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
  ContextInferFromTextRequestSchema,
  ContextInferFromTextResponseSchema,
  AgendaItemConfirmRequestSchema,
  AgendaItemConfirmResponseSchema,
  AgendaItemEditAndConfirmRequestSchema,
  AgendaItemEditAndConfirmResponseSchema,
  MeetingPauseRequestSchema,
  MeetingPauseResponseSchema,
  MeetingResumeRequestSchema,
  MeetingResumeResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  PingResponse,
  SettingsGetResponse,
  SettingsSetResponse,
  EgressState,
  SecretSetResponse,
  SecretHasResponse,
  ProviderTestConnectionResponse,
  MeetingCreateResponse,
  AgendaItemAddResponse,
  AgendaItemRemoveResponse,
  ParticipantAddResponse,
  ParticipantRemoveResponse,
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
  ContextInferFromTextRequest,
  ContextInferFromTextResponse,
  AgendaItemConfirmResponse,
  AgendaItemEditAndConfirmResponse,
  MeetingPauseResponse,
  MeetingResumeResponse,
} from '@shared/ipc'
import type { Clock } from '@shared/providers'

import type { agendaItemRepo } from './db/repos/agendaItemRepo'
import type { meetingRepo } from './db/repos/meetingRepo'
import type { participantRepo } from './db/repos/participantRepo'
import type { ModelDownloader } from './providers/sherpa/ModelDownloader'
import type { ItemLifecycleService } from './services/itemLifecycleService'
import type { ConnectionTestResult } from './settings/connectionTest'
import { computeEgressState } from './settings/egressState'
import type { SecretStorage } from './settings/SecretStorage'
import type { SettingsStore } from './settings/SettingsStore'

// A handler takes an unknown payload, validates it, and returns the result.
// The return is unknown at the type level; runtime callers use Promise.resolve() on it.
type Handler = (raw: unknown) => unknown

// ---------------------------------------------------------------------------
// Role interfaces (audit A2)
//
// Narrow ports the real collaborators already satisfy. `index.ts` passes the
// collaborator directly (e.g. `session: liveSession`); tests pass fakes. The
// registry never imports the concrete classes, so it stays decoupled + testable.
// ---------------------------------------------------------------------------

/** Live-session lifecycle. Satisfied by LiveSessionController. */
export interface SessionOps {
  /** Spin up the LiveExtractionRuntime for the active session (audio:start). */
  start(meetingId: string): void
  /** Tear down the active session (audio:stop). */
  stop(): void
  /** Run the final pass, emit items:summaries, transition Live → Ended (meeting:end). */
  endMeeting(meetingId: string): Promise<void>
  /** Pause the live meeting; returns the updated Meeting (meeting:pause). */
  pause(meetingId: string): Meeting
  /** Resume the live meeting; returns the updated Meeting (meeting:resume). */
  resume(meetingId: string): Meeting
  /** Answer a free-form question grounded in the active transcript (summary:query). */
  querySummary(question: string): Promise<string>
}

/**
 * Proposed/Confirmed item lifecycle. Satisfied by ItemLifecycleService. Picked
 * from the class so the port can never drift from the methods the handlers call.
 */
export type ItemOps = Pick<
  ItemLifecycleService,
  | 'confirm'
  | 'editAndConfirmDecision'
  | 'editAndConfirmAction'
  | 'dismiss'
  | 'createConfirmedDecision'
  | 'createConfirmedAction'
>

/** Read-only history over past meetings. Satisfied by MeetingQueryService. */
export interface HistoryOps {
  /** All meetings past Draft, newest-first (meeting:list). */
  list(): Meeting[]
  /** Full state of one past meeting, or null when not found (meeting:load). */
  load(meetingId: string): MeetingLoadResponse | null
  /** Delete a meeting and its child rows (meeting:delete). */
  delete(meetingId: string): void
}

/** Audio-file import. Satisfied by an object index.ts builds over ImportSessionController. */
export interface ImportOps {
  /** Start an import; returns the new meeting id (import:start). */
  start(req: ImportStartRequest): string
  /** Finish the import: transcribe, infer, final pass, mark Ended (import:finish). */
  finish(meetingId: string): Promise<ImportFinishResponse>
  /** Structure a pasted agenda into title + agenda items + participants (context:inferFromText). */
  inferFromText(req: ContextInferFromTextRequest): Promise<ContextInferFromTextResponse>
}

/** Local ASR model download. */
export interface ModelOps {
  downloader: ModelDownloader
  /**
   * Push a model:progress event to the renderer. A property-typed function (not
   * a method signature) so the download handler can hold a reference to it
   * without tripping @typescript-eslint/unbound-method.
   */
  pushProgress: (evt: ModelProgressEvent) => void
}

/** Provider credential probe (provider:testConnection). */
export interface ProviderOps {
  testConnection(role: 'asr' | 'extraction'): Promise<ConnectionTestResult>
}

/**
 * Electron-native side effects the pure registry cannot perform itself: the save
 * dialog, the clipboard, and reading + copying a meeting's transcript. Built in
 * index.ts over `dialog` / `clipboard` / `MeetingQueryService`.
 */
export interface PlatformOps {
  /** Save content to a user-chosen file (export:markdown). */
  exportFile(opts: {
    content: string
    defaultFilename: string
    filters: { name: string; extensions: string[] }[]
  }): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Copy content to the clipboard (export:copyMarkdown). */
  copyToClipboard(content: string): void
  /** Copy a meeting's full transcript to the clipboard (transcript:copy). */
  copyTranscript(meetingId: string): void
}

/**
 * Draft-prep repos backing meeting:create, agendaItem:* and participant:*.
 * Members stay individually optional so a caller that only prepares an agenda
 * (or only persists the meeting row) degrades exactly as before (audit C1).
 */
export interface PrepDeps {
  meetingRepo?: ReturnType<typeof meetingRepo>
  agendaItemRepo?: ReturnType<typeof agendaItemRepo>
  participantRepo?: ReturnType<typeof participantRepo>
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface IpcRegistryDependencies {
  /** Loaded SettingsStore instance. Must have load() already called. */
  settingsStore: SettingsStore
  /**
   * SecretStorage instance (item 0016). Handles API keys via safeStorage in
   * production, MemorySecretStorage in tests. Optional for tests that don't
   * exercise secret channels.
   */
  secretStorage?: SecretStorage
  /** Database instance (optional, for future persistence). */
  db?: unknown
  /** Clock for generating timestamps (meeting:create). */
  clock?: Clock

  /** Live-session lifecycle: audio:start/stop, meeting:end/pause/resume, summary:query. */
  session?: SessionOps
  /** Note-taker item actions: item:confirm/editAndConfirm/dismiss/createConfirmed. */
  items?: ItemOps
  /** Past-meeting reads: meeting:list/load/delete. */
  history?: HistoryOps
  /** Audio-file import: import:start/finish, context:inferFromText. */
  import?: ImportOps
  /** Local ASR model: model:status/download. */
  model?: ModelOps
  /** Draft-prep repos: meeting:create, agendaItem:*, participant:*. */
  prep?: PrepDeps
  /** Provider credential probe: provider:testConnection. */
  provider?: ProviderOps
  /** Electron-native side effects: export:markdown/copyMarkdown, transcript:copy. */
  platform?: PlatformOps
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
      titleAutoGenerated: req.titleAutoGenerated,
    }

    // Persist the row so the Draft title + quick-start flag reach the DB and the
    // LiveSessionController preserves them (instead of its "Active Meeting"
    // fallback). Optional dep keeps the registry unit-testable without a DB.
    deps.prep?.meetingRepo?.insert(meeting)

    return MeetingCreateResponseSchema.parse(meeting)
  }
}

function makeHandleAgendaItemAdd(deps: IpcRegistryDependencies) {
  return function handleAgendaItemAdd(raw: unknown): AgendaItemAddResponse {
    const req = AgendaItemAddRequestSchema.parse(raw)

    const agendaItem: AgendaItemAddResponse = {
      id: randomUUID(),
      title: req.title,
      topic: req.topic,
      state: 'confirmed',
    }

    // Persist against the real meeting so rolling-extraction routing sees the
    // agenda and meeting:load restores it (audit C1). Optional dep keeps the
    // registry unit-testable without a DB.
    deps.prep?.agendaItemRepo?.insert(agendaItem, req.meetingId)

    return AgendaItemAddResponseSchema.parse(agendaItem)
  }
}

function makeHandleAgendaItemRemove(deps: IpcRegistryDependencies) {
  return function handleAgendaItemRemove(raw: unknown): AgendaItemRemoveResponse {
    const req = AgendaItemRemoveRequestSchema.parse(raw)
    deps.prep?.agendaItemRepo?.delete(req.agendaItemId)
    return AgendaItemRemoveResponseSchema.parse({ ok: true })
  }
}

function makeHandleParticipantAdd(deps: IpcRegistryDependencies) {
  return function handleParticipantAdd(raw: unknown): ParticipantAddResponse {
    const req = ParticipantAddRequestSchema.parse(raw)

    const participant: ParticipantAddResponse = {
      id: randomUUID(),
      name: req.name,
    }

    // Persist against the real meeting so owner assignment has a participant list
    // and meeting:load restores it (audit C1).
    deps.prep?.participantRepo?.insert(participant, req.meetingId)

    return ParticipantAddResponseSchema.parse(participant)
  }
}

function makeHandleParticipantRemove(deps: IpcRegistryDependencies) {
  return function handleParticipantRemove(raw: unknown): ParticipantRemoveResponse {
    const req = ParticipantRemoveRequestSchema.parse(raw)
    deps.prep?.participantRepo?.delete(req.participantId)
    return ParticipantRemoveResponseSchema.parse({ ok: true })
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

function makeHandleProviderTestConnection(deps: IpcRegistryDependencies) {
  return async function handleProviderTestConnection(
    raw: unknown,
  ): Promise<ProviderTestConnectionResponse> {
    const req = ProviderTestConnectionRequestSchema.parse(raw)
    if (deps.provider === undefined) {
      return ProviderTestConnectionResponseSchema.parse({ ok: false, error: 'unavailable' })
    }
    const result = await deps.provider.testConnection(req.role)
    return ProviderTestConnectionResponseSchema.parse(result)
  }
}

function makeHandleAudioStart(deps: IpcRegistryDependencies) {
  return function handleAudioStart(raw: unknown): AudioStartResponse {
    const req = AudioStartRequestSchema.parse(raw)
    deps.session?.start(req.meetingId)
    return AudioStartResponseSchema.parse({ ok: true })
  }
}

function makeHandleAudioStop(deps: IpcRegistryDependencies) {
  return function handleAudioStop(raw: unknown): AudioStopResponse {
    AudioStopRequestSchema.parse(raw)
    deps.session?.stop()
    return AudioStopResponseSchema.parse({ ok: true })
  }
}

// ---------------------------------------------------------------------------
// Item action handlers (item 0018)
// ---------------------------------------------------------------------------

function makeHandleItemConfirm(deps: IpcRegistryDependencies) {
  return function handleItemConfirm(raw: unknown): ItemConfirmResponse {
    const req = ItemConfirmRequestSchema.parse(raw)
    if (deps.items === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    return deps.items.confirm({ kind: req.kind, id: req.id })
  }
}

function makeHandleItemEditAndConfirm(deps: IpcRegistryDependencies) {
  return function handleItemEditAndConfirm(raw: unknown): ItemEditAndConfirmResponse {
    const req = ItemEditAndConfirmRequestSchema.parse(raw)
    if (deps.items === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    if (req.kind === 'decision') {
      // Rebuild with only defined keys: under exactOptionalPropertyTypes a
      // value of `string | undefined` is not assignable to an optional `string`.
      const updates: Parameters<typeof deps.items.editAndConfirmDecision>[1] = {}
      if (req.updates.rationale !== undefined) updates.rationale = req.updates.rationale
      if (req.updates.agendaItemId !== undefined) updates.agendaItemId = req.updates.agendaItemId
      return deps.items.editAndConfirmDecision(req.id, updates)
    } else {
      const updates: Parameters<typeof deps.items.editAndConfirmAction>[1] = {}
      if (req.updates.status !== undefined) updates.status = req.updates.status
      if (req.updates.agendaItemId !== undefined) updates.agendaItemId = req.updates.agendaItemId
      if (req.updates.owner !== undefined) updates.owner = req.updates.owner
      if (req.updates.dueDate !== undefined) updates.dueDate = req.updates.dueDate
      return deps.items.editAndConfirmAction(req.id, updates)
    }
  }
}

function makeHandleItemDismiss(deps: IpcRegistryDependencies) {
  return function handleItemDismiss(raw: unknown): ItemDismissResponse {
    const req = ItemDismissRequestSchema.parse(raw)
    if (deps.items === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    deps.items.dismiss({ kind: req.kind, id: req.id })
    return ItemDismissResponseSchema.parse({ ok: true })
  }
}

function makeHandleItemCreateConfirmed(deps: IpcRegistryDependencies) {
  return function handleItemCreateConfirmed(raw: unknown): ItemCreateConfirmedResponse {
    const req = ItemCreateConfirmedRequestSchema.parse(raw)
    if (deps.items === undefined) {
      throw new Error('ItemLifecycleService is not available')
    }
    if (req.kind === 'decision') {
      return deps.items.createConfirmedDecision(req.meetingId, req.item)
    } else {
      return deps.items.createConfirmedAction(req.meetingId, req.item)
    }
  }
}

function makeHandleSummaryQuery(deps: IpcRegistryDependencies) {
  return async function handleSummaryQuery(raw: unknown): Promise<SummaryQueryResponse> {
    const req = SummaryQueryRequestSchema.parse(raw)
    const answer = deps.session !== undefined ? await deps.session.querySummary(req.question) : ''
    return SummaryQueryResponseSchema.parse({ answer })
  }
}

function makeHandleMeetingEnd(deps: IpcRegistryDependencies) {
  return async function handleMeetingEnd(raw: unknown): Promise<MeetingEndResponse> {
    const req = MeetingEndRequestSchema.parse(raw)
    if (deps.session !== undefined) {
      await deps.session.endMeeting(req.meetingId)
    }
    return MeetingEndResponseSchema.parse({ ok: true })
  }
}

function makeHandleExportMarkdown(deps: IpcRegistryDependencies) {
  return async function handleExportMarkdown(raw: unknown): Promise<ExportMarkdownResponse> {
    const req = ExportMarkdownRequestSchema.parse(raw)
    if (deps.platform === undefined) {
      return { ok: false, reason: 'not available' }
    }
    return deps.platform.exportFile({
      content: req.content,
      defaultFilename: 'notulen.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
  }
}

function makeHandleExportCopyMarkdown(deps: IpcRegistryDependencies) {
  return function handleExportCopyMarkdown(raw: unknown): ExportCopyMarkdownResponse {
    const req = ExportCopyMarkdownRequestSchema.parse(raw)
    deps.platform?.copyToClipboard(req.content)
    return ExportCopyMarkdownResponseSchema.parse({ ok: true })
  }
}

function makeHandleTranscriptCopy(deps: IpcRegistryDependencies) {
  return function handleTranscriptCopy(raw: unknown): TranscriptCopyResponse {
    const req = TranscriptCopyRequestSchema.parse(raw)
    deps.platform?.copyTranscript(req.meetingId)
    return TranscriptCopyResponseSchema.parse({ ok: true })
  }
}

function makeHandleMeetingList(deps: IpcRegistryDependencies) {
  return function handleMeetingList(raw: unknown): MeetingListResponse {
    MeetingListRequestSchema.parse(raw)
    const meetings = deps.history?.list() ?? []
    return MeetingListResponseSchema.parse({ meetings })
  }
}

function makeHandleMeetingLoad(deps: IpcRegistryDependencies) {
  return function handleMeetingLoad(raw: unknown): MeetingLoadResponse {
    const req = MeetingLoadRequestSchema.parse(raw)
    if (deps.history === undefined) {
      throw new Error('meeting:load is not available')
    }
    const result = deps.history.load(req.meetingId)
    if (result === null) {
      throw new Error(`Meeting not found: ${req.meetingId}`)
    }
    return MeetingLoadResponseSchema.parse(result)
  }
}

function makeHandleMeetingDelete(deps: IpcRegistryDependencies) {
  return function handleMeetingDelete(raw: unknown): MeetingDeleteResponse {
    const req = MeetingDeleteRequestSchema.parse(raw)
    deps.history?.delete(req.meetingId)
    return MeetingDeleteResponseSchema.parse({ ok: true })
  }
}

function makeHandleModelStatus(deps: IpcRegistryDependencies) {
  return function handleModelStatus(raw: unknown): ModelStatusResponse {
    const req = ModelStatusRequestSchema.parse(raw)
    const downloaded = deps.model?.downloader.isDownloaded() ?? false
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

    if (deps.model === undefined) {
      throw new Error('model:download is not available — ModelDownloader not configured')
    }

    const downloader = deps.model.downloader
    const push = deps.model.pushProgress
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
    if (deps.import === undefined) {
      throw new Error('import:start is not available')
    }
    const meetingId = deps.import.start(req)
    return ImportStartResponseSchema.parse({ meetingId })
  }
}

function makeHandleImportFinish(deps: IpcRegistryDependencies) {
  return async function handleImportFinish(raw: unknown): Promise<ImportFinishResponse> {
    const req = ImportFinishRequestSchema.parse(raw)
    if (deps.import === undefined) {
      throw new Error('import:finish is not available')
    }
    return deps.import.finish(req.meetingId)
  }
}

function makeHandleInferContextFromText(deps: IpcRegistryDependencies) {
  return async function handleInferContextFromText(
    raw: unknown,
  ): Promise<ContextInferFromTextResponse> {
    const req = ContextInferFromTextRequestSchema.parse(raw)
    // Degrade gracefully: no import group wired ⇒ empty context, so the Draft
    // screen keeps manual entry working (ADR 0029).
    if (deps.import === undefined) {
      return ContextInferFromTextResponseSchema.parse({ agendaItems: [], participants: [] })
    }
    const result = await deps.import.inferFromText(req)
    return ContextInferFromTextResponseSchema.parse(result)
  }
}

function makeHandleAgendaItemConfirm(deps: IpcRegistryDependencies) {
  return function handleAgendaItemConfirm(raw: unknown): AgendaItemConfirmResponse {
    const req = AgendaItemConfirmRequestSchema.parse(raw)
    const repo = deps.prep?.agendaItemRepo
    if (repo === undefined) {
      throw new Error('agendaItem:confirm is not available')
    }
    const item = repo.findById(req.agendaItemId)
    if (item === null) {
      throw new Error('agendaItem:confirm: item not found')
    }
    const confirmed = { ...item, state: 'confirmed' as const }
    repo.update(confirmed)
    return AgendaItemConfirmResponseSchema.parse(confirmed)
  }
}

function makeHandleAgendaItemEditAndConfirm(deps: IpcRegistryDependencies) {
  return function handleAgendaItemEditAndConfirm(raw: unknown): AgendaItemEditAndConfirmResponse {
    const req = AgendaItemEditAndConfirmRequestSchema.parse(raw)
    const repo = deps.prep?.agendaItemRepo
    if (repo === undefined) {
      throw new Error('agendaItem:editAndConfirm is not available')
    }
    const item = repo.findById(req.agendaItemId)
    if (item === null) {
      throw new Error('agendaItem:editAndConfirm: item not found')
    }
    const updated = { ...item, title: req.title, topic: req.topic, state: 'confirmed' as const }
    repo.update(updated)
    return AgendaItemEditAndConfirmResponseSchema.parse(updated)
  }
}

function makeHandleMeetingPause(deps: IpcRegistryDependencies) {
  return function handleMeetingPause(raw: unknown): MeetingPauseResponse {
    const req = MeetingPauseRequestSchema.parse(raw)
    if (deps.session === undefined) {
      throw new Error('meeting:pause is not available')
    }
    return MeetingPauseResponseSchema.parse(deps.session.pause(req.meetingId))
  }
}

function makeHandleMeetingResume(deps: IpcRegistryDependencies) {
  return function handleMeetingResume(raw: unknown): MeetingResumeResponse {
    const req = MeetingResumeRequestSchema.parse(raw)
    if (deps.session === undefined) {
      throw new Error('meeting:resume is not available')
    }
    return MeetingResumeResponseSchema.parse(deps.session.resume(req.meetingId))
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
    'provider:testConnection': makeHandleProviderTestConnection(deps),
    'meeting:create': makeHandleMeetingCreate(deps),
    'agendaItem:add': makeHandleAgendaItemAdd(deps),
    'agendaItem:remove': makeHandleAgendaItemRemove(deps),
    'participant:add': makeHandleParticipantAdd(deps),
    'participant:remove': makeHandleParticipantRemove(deps),
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
    'context:inferFromText': makeHandleInferContextFromText(deps),
    'agendaItem:confirm': makeHandleAgendaItemConfirm(deps),
    'agendaItem:editAndConfirm': makeHandleAgendaItemEditAndConfirm(deps),
    'meeting:pause': makeHandleMeetingPause(deps),
    'meeting:resume': makeHandleMeetingResume(deps),
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
