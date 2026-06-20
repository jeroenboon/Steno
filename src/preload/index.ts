/**
 * Preload script — the only bridge between the renderer and the main process.
 *
 * Rules:
 * - Only contextBridge.exposeInMainWorld may be used here. No direct Node
 *   API calls that would leak privileged access to the renderer.
 * - The exposed API surface must exactly match the RendererApi type from
 *   @shared/ipc so the renderer gets full TypeScript coverage with zero
 *   raw ipcRenderer usage.
 */

import { contextBridge, ipcRenderer } from 'electron'

import type { TranscriptSpan } from '@shared/domain/types'
import type {
  RendererApi,
  SettingsSetRequest,
  EgressState,
  SettingsGetResponse,
  SettingsSetResponse,
  SecretSetRequest,
  SecretSetResponse,
  SecretHasRequest,
  SecretHasResponse,
  MeetingCreateRequest,
  MeetingCreateResponse,
  AgendaItemAddRequest,
  AgendaItemAddResponse,
  AgendaItemRemoveRequest,
  AgendaItemRemoveResponse,
  ParticipantAddRequest,
  ParticipantAddResponse,
  ParticipantRemoveRequest,
  ParticipantRemoveResponse,
  MeetingStartRequest,
  MeetingStartResponse,
  MeetingEndRequest,
  MeetingEndResponse,
  AudioStartResponse,
  AudioStopResponse,
  UnsubscribeFn,
  ItemsChangedPayload,
  ItemsSummariesPayload,
  ItemConfirmRequest,
  ItemConfirmResponse,
  ItemEditAndConfirmRequest,
  ItemEditAndConfirmResponse,
  ItemDismissRequest,
  ItemDismissResponse,
  ItemCreateConfirmedRequest,
  ItemCreateConfirmedResponse,
  NudgesChangedPayload,
  SummaryChangedPayload,
  SummaryQueryRequest,
  SummaryQueryResponse,
  ExportMarkdownRequest,
  ExportMarkdownResponse,
  ExportJsonRequest,
  ExportJsonResponse,
  ExportCopyMarkdownRequest,
  ExportCopyMarkdownResponse,
  MeetingListRequest,
  MeetingListResponse,
  MeetingLoadRequest,
  MeetingLoadResponse,
  ModelStatusRequest,
  ModelStatusResponse,
  ModelDownloadRequest,
  ModelDownloadResponse,
  ModelProgressEvent,
} from '@shared/ipc'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke('ping', {}) as Promise<{ pong: true }>,
  settingsGet: () => ipcRenderer.invoke('settings:get', {}) as Promise<SettingsGetResponse>,
  settingsSet: (settings: SettingsSetRequest) =>
    ipcRenderer.invoke('settings:set', settings) as Promise<SettingsSetResponse>,
  egressState: () => ipcRenderer.invoke('egress:state', {}) as Promise<EgressState>,
  meetingCreate: (req: MeetingCreateRequest) =>
    ipcRenderer.invoke('meeting:create', req) as Promise<MeetingCreateResponse>,
  agendaItemAdd: (req: AgendaItemAddRequest) =>
    ipcRenderer.invoke('agendaItem:add', req) as Promise<AgendaItemAddResponse>,
  agendaItemRemove: (req: AgendaItemRemoveRequest) =>
    ipcRenderer.invoke('agendaItem:remove', req) as Promise<AgendaItemRemoveResponse>,
  participantAdd: (req: ParticipantAddRequest) =>
    ipcRenderer.invoke('participant:add', req) as Promise<ParticipantAddResponse>,
  participantRemove: (req: ParticipantRemoveRequest) =>
    ipcRenderer.invoke('participant:remove', req) as Promise<ParticipantRemoveResponse>,
  meetingStart: (req: MeetingStartRequest) =>
    ipcRenderer.invoke('meeting:start', req) as Promise<MeetingStartResponse>,

  // ---------------------------------------------------------------------------
  // Secrets (item 0016) — write-only; no secret:get channel
  // ---------------------------------------------------------------------------

  secretSet: (req: SecretSetRequest) =>
    ipcRenderer.invoke('secret:set', req) as Promise<SecretSetResponse>,
  secretHas: (req: SecretHasRequest) =>
    ipcRenderer.invoke('secret:has', req) as Promise<SecretHasResponse>,

  // ---------------------------------------------------------------------------
  // Audio capture (item 0015)
  // ---------------------------------------------------------------------------

  audioStart: () => ipcRenderer.invoke('audio:start', {}) as Promise<AudioStartResponse>,
  audioStop: () => ipcRenderer.invoke('audio:stop', {}) as Promise<AudioStopResponse>,

  /**
   * Fire-and-forget: send a PCM frame to main without waiting for a response.
   * Uses ipcRenderer.send (one-way), not invoke, to minimise per-frame overhead.
   */
  audioSendFrame: (frame: Uint8Array) => {
    ipcRenderer.send('audio:frame', frame)
  },

  /**
   * Subscribe to transcript spans pushed by main via webContents.send.
   * Returns an unsubscribe function (the preload holds no global listener state).
   */
  onTranscriptSpan: (cb: (span: TranscriptSpan) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, span: TranscriptSpan) => {
      cb(span)
    }
    ipcRenderer.on('transcript:span', listener)
    return () => {
      ipcRenderer.removeListener('transcript:span', listener)
    }
  },

  /**
   * Subscribe to proposed-item updates pushed from main (item 0018).
   * Fired after every rolling extraction turn or final pass that proposes ≥1 item.
   * Returns an unsubscribe function.
   */
  onItemsChanged: (cb: (payload: ItemsChangedPayload) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ItemsChangedPayload) => {
      cb(payload)
    }
    ipcRenderer.on('items:changed', listener)
    return () => {
      ipcRenderer.removeListener('items:changed', listener)
    }
  },

  /**
   * Subscribe to Discussion Summary events pushed from main (item 0018).
   * Fired exactly once after the final extraction pass completes (meeting end).
   * Returns an unsubscribe function.
   */
  onItemsSummaries: (cb: (payload: ItemsSummariesPayload) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ItemsSummariesPayload) => {
      cb(payload)
    }
    ipcRenderer.on('items:summaries', listener)
    return () => {
      ipcRenderer.removeListener('items:summaries', listener)
    }
  },

  // ---------------------------------------------------------------------------
  // Item note-taker actions (item 0018)
  // ---------------------------------------------------------------------------

  itemConfirm: (req: ItemConfirmRequest) =>
    ipcRenderer.invoke('item:confirm', req) as Promise<ItemConfirmResponse>,

  itemEditAndConfirm: (req: ItemEditAndConfirmRequest) =>
    ipcRenderer.invoke('item:editAndConfirm', req) as Promise<ItemEditAndConfirmResponse>,

  itemDismiss: (req: ItemDismissRequest) =>
    ipcRenderer.invoke('item:dismiss', req) as Promise<ItemDismissResponse>,

  itemCreateConfirmed: (req: ItemCreateConfirmedRequest) =>
    ipcRenderer.invoke('item:createConfirmed', req) as Promise<ItemCreateConfirmedResponse>,

  // ---------------------------------------------------------------------------
  // Nudges (item 0019)
  // ---------------------------------------------------------------------------

  onNudgesChanged: (cb: (payload: NudgesChangedPayload) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: NudgesChangedPayload) => {
      cb(payload)
    }
    ipcRenderer.on('nudges:changed', listener)
    return () => {
      ipcRenderer.removeListener('nudges:changed', listener)
    }
  },

  // ---------------------------------------------------------------------------
  // Running summary (item 0020)
  // ---------------------------------------------------------------------------

  onSummaryChanged: (cb: (payload: SummaryChangedPayload) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SummaryChangedPayload) => {
      cb(payload)
    }
    ipcRenderer.on('summary:changed', listener)
    return () => {
      ipcRenderer.removeListener('summary:changed', listener)
    }
  },

  summaryQuery: (req: SummaryQueryRequest) =>
    ipcRenderer.invoke('summary:query', req) as Promise<SummaryQueryResponse>,

  meetingEnd: (req: MeetingEndRequest) =>
    ipcRenderer.invoke('meeting:end', req) as Promise<MeetingEndResponse>,

  exportMarkdown: (req: ExportMarkdownRequest) =>
    ipcRenderer.invoke('export:markdown', req) as Promise<ExportMarkdownResponse>,
  exportJson: (req: ExportJsonRequest) =>
    ipcRenderer.invoke('export:json', req) as Promise<ExportJsonResponse>,
  exportCopyMarkdown: (req: ExportCopyMarkdownRequest) =>
    ipcRenderer.invoke('export:copyMarkdown', req) as Promise<ExportCopyMarkdownResponse>,

  // ---------------------------------------------------------------------------
  // Meeting history (item 0023)
  // ---------------------------------------------------------------------------

  meetingList: (req: MeetingListRequest) =>
    ipcRenderer.invoke('meeting:list', req) as Promise<MeetingListResponse>,
  meetingLoad: (req: MeetingLoadRequest) =>
    ipcRenderer.invoke('meeting:load', req) as Promise<MeetingLoadResponse>,

  // ---------------------------------------------------------------------------
  // Local model management (item 0024)
  // ---------------------------------------------------------------------------

  modelStatus: (req: ModelStatusRequest) =>
    ipcRenderer.invoke('model:status', req) as Promise<ModelStatusResponse>,
  modelDownload: (req: ModelDownloadRequest) =>
    ipcRenderer.invoke('model:download', req) as Promise<ModelDownloadResponse>,

  onModelProgress: (cb: (evt: ModelProgressEvent) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, evt: ModelProgressEvent) => {
      cb(evt)
    }
    ipcRenderer.on('model:progress', listener)
    return () => {
      ipcRenderer.removeListener('model:progress', listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
