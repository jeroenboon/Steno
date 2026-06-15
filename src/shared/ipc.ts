/**
 * IPC contract for main ↔ renderer communication.
 *
 * Channel names, request types, and response types are all defined here.
 * The renderer never touches ipcRenderer directly — everything goes through
 * the typed preload bridge (window.api).
 *
 * Zod schemas serve as the single source of truth; TypeScript types are
 * derived from them via z.infer.
 */

import { z } from 'zod'

import { MeetingSchema, AgendaItemSchema, ParticipantSchema } from './domain'
import { type EgressState } from './settings/egressState'
import { AppSettingsSchema } from './settings/settingsSchema'

// ---------------------------------------------------------------------------
// ping — smoke-test channel proving the bridge is alive
// ---------------------------------------------------------------------------

export const PingRequestSchema = z.object({})

export const PingResponseSchema = z.object({
  pong: z.literal(true),
})

export type PingRequest = z.infer<typeof PingRequestSchema>
export type PingResponse = z.infer<typeof PingResponseSchema>

// ---------------------------------------------------------------------------
// settings:get — retrieve current persisted settings
// ---------------------------------------------------------------------------

export const SettingsGetRequestSchema = z.object({})
export const SettingsGetResponseSchema = AppSettingsSchema

export type SettingsGetRequest = z.infer<typeof SettingsGetRequestSchema>
export type SettingsGetResponse = z.infer<typeof SettingsGetResponseSchema>

// ---------------------------------------------------------------------------
// settings:set — persist new settings (partial updates not supported;
// always send the full settings object)
// ---------------------------------------------------------------------------

export const SettingsSetRequestSchema = AppSettingsSchema
export const SettingsSetResponseSchema = z.object({ ok: z.literal(true) })

export type SettingsSetRequest = z.infer<typeof SettingsSetRequestSchema>
export type SettingsSetResponse = z.infer<typeof SettingsSetResponseSchema>

// ---------------------------------------------------------------------------
// egress:state — derive the current egress state from persisted settings
// ---------------------------------------------------------------------------

export const EgressStateGetRequestSchema = z.object({})

/**
 * EgressState is serialised over IPC as a plain object. We re-validate it
 * on the renderer side via this schema (principle #8 — validate at every
 * boundary).
 */
export const EgressStateGetResponseSchema = z.object({
  audio: z.union([z.literal('local'), z.string().startsWith('cloud:')]),
  notes: z.string().startsWith('cloud:'),
})

export type EgressStateGetRequest = z.infer<typeof EgressStateGetRequestSchema>
// Re-export EgressState as the IPC response type so the renderer can use it
export type { EgressState }

// ---------------------------------------------------------------------------
// meeting:create — create a new meeting in draft state (item 0014)
// ---------------------------------------------------------------------------

export const MeetingCreateRequestSchema = z.object({
  title: z.string().min(1, 'Meeting title cannot be empty'),
  primaryLanguage: z.string().min(1, 'Primary language cannot be empty'),
})

export const MeetingCreateResponseSchema = MeetingSchema

export type MeetingCreateRequest = z.infer<typeof MeetingCreateRequestSchema>
export type MeetingCreateResponse = z.infer<typeof MeetingCreateResponseSchema>

// ---------------------------------------------------------------------------
// agendaItem:add — add an agenda item to a meeting (item 0014)
// ---------------------------------------------------------------------------

export const AgendaItemAddRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
  title: z.string().min(1, 'Agenda item title cannot be empty'),
  topic: z.string().min(1, 'Agenda item topic cannot be empty'),
})

export const AgendaItemAddResponseSchema = AgendaItemSchema

export type AgendaItemAddRequest = z.infer<typeof AgendaItemAddRequestSchema>
export type AgendaItemAddResponse = z.infer<typeof AgendaItemAddResponseSchema>

// ---------------------------------------------------------------------------
// agendaItem:remove — remove an agenda item (item 0014)
// ---------------------------------------------------------------------------

export const AgendaItemRemoveRequestSchema = z.object({
  agendaItemId: z.string().min(1, 'Agenda item ID cannot be empty'),
})

export const AgendaItemRemoveResponseSchema = z.object({ ok: z.literal(true) })

export type AgendaItemRemoveRequest = z.infer<typeof AgendaItemRemoveRequestSchema>
export type AgendaItemRemoveResponse = z.infer<typeof AgendaItemRemoveResponseSchema>

// ---------------------------------------------------------------------------
// participant:add — add a participant to a meeting (item 0014)
// ---------------------------------------------------------------------------

export const ParticipantAddRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
  name: z.string().min(1, 'Participant name cannot be empty'),
})

export const ParticipantAddResponseSchema = ParticipantSchema

export type ParticipantAddRequest = z.infer<typeof ParticipantAddRequestSchema>
export type ParticipantAddResponse = z.infer<typeof ParticipantAddResponseSchema>

// ---------------------------------------------------------------------------
// participant:remove — remove a participant (item 0014)
// ---------------------------------------------------------------------------

export const ParticipantRemoveRequestSchema = z.object({
  participantId: z.string().min(1, 'Participant ID cannot be empty'),
})

export const ParticipantRemoveResponseSchema = z.object({ ok: z.literal(true) })

export type ParticipantRemoveRequest = z.infer<typeof ParticipantRemoveRequestSchema>
export type ParticipantRemoveResponse = z.infer<typeof ParticipantRemoveResponseSchema>

// ---------------------------------------------------------------------------
// meeting:start — transition a draft meeting to live (item 0014)
// ---------------------------------------------------------------------------

export const MeetingStartRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})

export const MeetingStartResponseSchema = MeetingSchema

export type MeetingStartRequest = z.infer<typeof MeetingStartRequestSchema>
export type MeetingStartResponse = z.infer<typeof MeetingStartResponseSchema>

// ---------------------------------------------------------------------------
// audio:start — tell main to open an ASR session (item 0015)
// ---------------------------------------------------------------------------

export const AudioStartRequestSchema = z.object({})
export const AudioStartResponseSchema = z.object({ ok: z.literal(true) })

export type AudioStartRequest = z.infer<typeof AudioStartRequestSchema>
export type AudioStartResponse = z.infer<typeof AudioStartResponseSchema>

// ---------------------------------------------------------------------------
// secret:set — write an API key into safeStorage (item 0016)
//
// The renderer sends the key value exactly once during the user's key-entry
// flow. Main encrypts it via safeStorage and stores it; the value is never
// sent back to the renderer. There is deliberately NO secret:get channel.
// ---------------------------------------------------------------------------

export const SecretSetRequestSchema = z.object({
  /** Stable key name used to look up the secret (e.g. 'deepgram', 'anthropic'). */
  key: z.string().min(1),
  /** The raw API key value — encrypted by main, never stored in settings JSON. */
  value: z.string().min(1),
})

export const SecretSetResponseSchema = z.object({ ok: z.literal(true) })

export type SecretSetRequest = z.infer<typeof SecretSetRequestSchema>
export type SecretSetResponse = z.infer<typeof SecretSetResponseSchema>

// ---------------------------------------------------------------------------
// secret:has — check whether a key is present in safeStorage (item 0016)
//
// Returns a boolean presence flag. Never returns the key value.
// ---------------------------------------------------------------------------

export const SecretHasRequestSchema = z.object({
  key: z.string().min(1),
})

export const SecretHasResponseSchema = z.object({
  /** true if a secret is stored for this key, false otherwise. */
  has: z.boolean(),
})

export type SecretHasRequest = z.infer<typeof SecretHasRequestSchema>
export type SecretHasResponse = z.infer<typeof SecretHasResponseSchema>

// ---------------------------------------------------------------------------
// audio:stop — tell main to close the active ASR session (item 0015)
// ---------------------------------------------------------------------------

export const AudioStopRequestSchema = z.object({})
export const AudioStopResponseSchema = z.object({ ok: z.literal(true) })

export type AudioStopRequest = z.infer<typeof AudioStopRequestSchema>
export type AudioStopResponse = z.infer<typeof AudioStopResponseSchema>

// ---------------------------------------------------------------------------
// transcript:span — main → renderer event (item 0015)
//
// NOT an invoke channel. Main pushes spans via webContents.send; the preload
// exposes onTranscriptSpan(cb) / offTranscriptSpan(cb) for the renderer.
// We validate the incoming payload with this schema on the renderer side.
// ---------------------------------------------------------------------------

export { TranscriptSpanSchema } from './domain/types'
export type { TranscriptSpan } from './domain/types'

// ---------------------------------------------------------------------------
// Channel registry — exhaustive union of all channel names
// ---------------------------------------------------------------------------

export type IpcChannel =
  | 'ping'
  | 'settings:get'
  | 'settings:set'
  | 'egress:state'
  | 'secret:set'
  | 'secret:has'
  | 'meeting:create'
  | 'agendaItem:add'
  | 'agendaItem:remove'
  | 'participant:add'
  | 'participant:remove'
  | 'meeting:start'
  | 'audio:start'
  | 'audio:stop'

/**
 * One-way channels: renderer sends, main receives (no invoke/response).
 * These are registered via ipcMain.on, not ipcMain.handle.
 */
export type IpcOnewayChannel = 'audio:frame'

// ---------------------------------------------------------------------------
// Typed preload API surface exposed to the renderer via contextBridge
// ---------------------------------------------------------------------------

/** Cleanup function returned by onTranscriptSpan; call to remove the listener. */
export type UnsubscribeFn = () => void

export interface RendererApi {
  /** Send a ping to main; resolves with { pong: true }. */
  ping: () => Promise<PingResponse>
  /** Retrieve the current persisted settings. */
  settingsGet: () => Promise<SettingsGetResponse>
  /** Persist new settings. Replaces the full settings object. */
  settingsSet: (settings: SettingsSetRequest) => Promise<SettingsSetResponse>
  /** Get the current egress state derived from settings. */
  egressState: () => Promise<EgressState>
  /** Create a new meeting in draft state. */
  meetingCreate: (req: MeetingCreateRequest) => Promise<MeetingCreateResponse>
  /** Add an agenda item to a meeting. */
  agendaItemAdd: (req: AgendaItemAddRequest) => Promise<AgendaItemAddResponse>
  /** Remove an agenda item. */
  agendaItemRemove: (req: AgendaItemRemoveRequest) => Promise<AgendaItemRemoveResponse>
  /** Add a participant to a meeting. */
  participantAdd: (req: ParticipantAddRequest) => Promise<ParticipantAddResponse>
  /** Remove a participant. */
  participantRemove: (req: ParticipantRemoveRequest) => Promise<ParticipantRemoveResponse>
  /** Start a meeting (Draft → Live). */
  meetingStart: (req: MeetingStartRequest) => Promise<MeetingStartResponse>
  /**
   * Write an API key into safeStorage. The key value is transmitted to main
   * exactly once during entry and is never returned to the renderer.
   * (item 0016)
   */
  secretSet: (req: SecretSetRequest) => Promise<SecretSetResponse>
  /**
   * Check whether an API key is stored for the given name.
   * Returns a boolean presence flag — never the key value.
   * (item 0016)
   */
  secretHas: (req: SecretHasRequest) => Promise<SecretHasResponse>
  /**
   * Tell main to open an ASR session. Call before sending audio frames.
   * (item 0015)
   */
  audioStart: () => Promise<AudioStartResponse>
  /**
   * Tell main to close the active ASR session.
   * (item 0015)
   */
  audioStop: () => Promise<AudioStopResponse>
  /**
   * Send a raw PCM audio frame (Int16 LE, Uint8Array) to main.
   * Fire-and-forget: no response. Uses ipcRenderer.send, not invoke.
   * (item 0015)
   */
  audioSendFrame: (frame: Uint8Array) => void
  /**
   * Subscribe to transcript spans pushed from main.
   * Returns an unsubscribe function.
   * (item 0015)
   */
  onTranscriptSpan: (cb: (span: import('./domain/types').TranscriptSpan) => void) => UnsubscribeFn
}
