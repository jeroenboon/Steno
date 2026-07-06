/**
 * Preload script — the only bridge between the renderer and the main process.
 *
 * Rules:
 * - Only contextBridge.exposeInMainWorld may be used here. No direct Node
 *   API calls that would leak privileged access to the renderer.
 * - The exposed API surface must exactly match the RendererApi type from
 *   @shared/ipc so the renderer gets full TypeScript coverage with zero
 *   raw ipcRenderer usage.
 *
 * The object below is a thin, declarative mapping: request/response channels go
 * through `invoke()` (which Zod-validates the response — audit C8), push
 * channels through `subscribe()`, and the two fire-and-forget frame channels
 * through ipcRenderer.send. See ./bridge.ts for the helpers.
 */

import { contextBridge, ipcRenderer } from 'electron'

import type { RendererApi, EgressState } from '@shared/ipc'

import { invoke, subscribe } from './bridge'

const api: RendererApi = {
  ping: () => invoke('ping', {}),
  settingsGet: () => invoke('settings:get', {}),
  settingsSet: (settings) => invoke('settings:set', settings),
  // egress:state's response schema validates the `cloud:` prefix at runtime via
  // startsWith(), which infers statically as `string`; EgressState narrows that
  // to a template-literal type. The response is still Zod-validated by invoke();
  // this cast only re-narrows the static type to the domain type.
  egressState: () => invoke('egress:state', {}) as Promise<EgressState>,
  meetingCreate: (req) => invoke('meeting:create', req),
  agendaItemAdd: (req) => invoke('agendaItem:add', req),
  agendaItemRemove: (req) => invoke('agendaItem:remove', req),
  participantAdd: (req) => invoke('participant:add', req),
  participantRemove: (req) => invoke('participant:remove', req),

  // ---------------------------------------------------------------------------
  // Secrets (item 0016) — write-only; no secret:get channel
  // ---------------------------------------------------------------------------

  secretSet: (req) => invoke('secret:set', req),
  secretHas: (req) => invoke('secret:has', req),

  providerTestConnection: (req) => invoke('provider:testConnection', req),

  // ---------------------------------------------------------------------------
  // Audio capture (item 0015)
  // ---------------------------------------------------------------------------

  audioStart: (req) => invoke('audio:start', req),
  audioStop: () => invoke('audio:stop', {}),

  /**
   * Fire-and-forget: send a PCM frame to main without waiting for a response.
   * Uses ipcRenderer.send (one-way), not invoke, to minimise per-frame overhead.
   */
  audioSendFrame: (frame) => {
    ipcRenderer.send('audio:frame', frame)
  },

  /**
   * Subscribe to transcript spans pushed by main via webContents.send.
   * Returns an unsubscribe function (the preload holds no global listener state).
   */
  onTranscriptSpan: (cb) => subscribe('transcript:span', cb),

  /**
   * Subscribe to proposed-item updates pushed from main (item 0018).
   * Fired after every rolling extraction turn or final pass that proposes ≥1 item.
   */
  onItemsChanged: (cb) => subscribe('items:changed', cb),

  /**
   * Subscribe to Discussion Summary events pushed from main (item 0018).
   * Fired exactly once after the final extraction pass completes (meeting end).
   */
  onItemsSummaries: (cb) => subscribe('items:summaries', cb),

  // ---------------------------------------------------------------------------
  // Item note-taker actions (item 0018)
  // ---------------------------------------------------------------------------

  itemConfirm: (req) => invoke('item:confirm', req),
  itemEditAndConfirm: (req) => invoke('item:editAndConfirm', req),
  itemDismiss: (req) => invoke('item:dismiss', req),
  itemCreateConfirmed: (req) => invoke('item:createConfirmed', req),

  // ---------------------------------------------------------------------------
  // Nudges (item 0019)
  // ---------------------------------------------------------------------------

  onNudgesChanged: (cb) => subscribe('nudges:changed', cb),

  // ---------------------------------------------------------------------------
  // Running summary (item 0020)
  // ---------------------------------------------------------------------------

  onSummaryChanged: (cb) => subscribe('summary:changed', cb),
  summaryQuery: (req) => invoke('summary:query', req),

  meetingEnd: (req) => invoke('meeting:end', req),

  exportMarkdown: (req) => invoke('export:markdown', req),
  exportCopyMarkdown: (req) => invoke('export:copyMarkdown', req),

  transcriptCopy: (req) => invoke('transcript:copy', req),

  // ---------------------------------------------------------------------------
  // Meeting history (item 0023)
  // ---------------------------------------------------------------------------

  meetingList: (req) => invoke('meeting:list', req),
  meetingLoad: (req) => invoke('meeting:load', req),
  meetingDelete: (req) => invoke('meeting:delete', req),

  // ---------------------------------------------------------------------------
  // Local model management (item 0024)
  // ---------------------------------------------------------------------------

  modelStatus: (req) => invoke('model:status', req),
  modelDownload: (req) => invoke('model:download', req),

  onModelProgress: (cb) => subscribe('model:progress', cb),

  // ---------------------------------------------------------------------------
  // Audio-file import (item 0026)
  // ---------------------------------------------------------------------------

  importStart: (req) => invoke('import:start', req),

  /** Fire-and-forget: send a decoded PCM frame for the active import. */
  importSendFrame: (frame) => {
    ipcRenderer.send('import:frame', frame)
  },

  importFinish: (req) => invoke('import:finish', req),

  onImportProgress: (cb) => subscribe('import:progress', cb),

  // ---------------------------------------------------------------------------
  // Paste an agenda (ADR 0029)
  // ---------------------------------------------------------------------------

  inferContextFromText: (req) => invoke('context:inferFromText', req),

  // ---------------------------------------------------------------------------
  // Live agenda grooming (ADR 0029)
  // ---------------------------------------------------------------------------

  onAgendaChanged: (cb) => subscribe('agenda:changed', cb),

  agendaItemConfirm: (req) => invoke('agendaItem:confirm', req),
  agendaItemEditAndConfirm: (req) => invoke('agendaItem:editAndConfirm', req),

  meetingPause: (req) => invoke('meeting:pause', req),
  meetingResume: (req) => invoke('meeting:resume', req),
}

contextBridge.exposeInMainWorld('api', api)
