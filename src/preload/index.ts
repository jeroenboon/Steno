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
  AudioStartResponse,
  AudioStopResponse,
  UnsubscribeFn,
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
}

contextBridge.exposeInMainWorld('api', api)
