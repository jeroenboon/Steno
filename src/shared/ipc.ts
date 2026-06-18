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
import { DecisionSchema, ActionSchema, NudgeSchema } from './domain/types'
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
// items:changed — main → renderer push event (item 0018)
//
// Emitted after every rolling extraction turn (or final pass) that produces
// ≥1 newly proposed Decision or Action. Carries the full proposed set for
// that turn so the renderer can merge/replace its local state.
//
// Pattern: webContents.send('items:changed', payload) on main;
//          ipcRenderer.on('items:changed', listener) in preload, exposed as
//          window.api.onItemsChanged(cb) returning an UnsubscribeFn.
// ---------------------------------------------------------------------------

export { DecisionSchema, ActionSchema, DiscussionSummarySchema, NudgeSchema } from './domain/types'
export type { Decision, Action, DiscussionSummary, Nudge } from './domain/types'

export const ItemsChangedPayloadSchema = z.object({
  /** Decisions proposed in this extraction turn. */
  decisions: z.array(
    z.object({
      id: z.string().min(1),
      rationale: z.string(),
      agendaItemId: z.string().min(1),
      sourceSpanId: z.string().min(1),
      state: z.enum(['proposed', 'confirmed']),
    }),
  ),
  /** Actions proposed in this extraction turn. */
  actions: z.array(
    z.object({
      id: z.string().min(1),
      agendaItemId: z.string().min(1),
      sourceSpanId: z.string().min(1),
      owner: z.string().min(1).optional(),
      dueDate: z.string().datetime().optional(),
      status: z.enum(['open', 'done']),
      state: z.enum(['proposed', 'confirmed']),
    }),
  ),
})

export type ItemsChangedPayload = z.infer<typeof ItemsChangedPayloadSchema>

// ---------------------------------------------------------------------------
// items:summaries — main → renderer push event (item 0018)
//
// Emitted exactly once after the final extraction pass completes (when the
// meeting ends). Carries all Discussion Summaries produced by the final pass.
// ---------------------------------------------------------------------------

export const ItemsSummariesPayloadSchema = z.object({
  summaries: z.array(
    z.object({
      id: z.string().min(1),
      agendaItemId: z.string().min(1),
      text: z.string(),
    }),
  ),
})

export type ItemsSummariesPayload = z.infer<typeof ItemsSummariesPayloadSchema>

// ---------------------------------------------------------------------------
// nudges:changed — main → renderer push event (item 0019)
//
// Emitted after every extraction turn (same timing as items:changed) and
// whenever note-taker actions change the confirmed set. Carries the full
// derived nudge array so the renderer can replace its local nudge state.
//
// Pattern: webContents.send('nudges:changed', payload) on main;
//          ipcRenderer.on('nudges:changed', listener) in preload, exposed as
//          window.api.onNudgesChanged(cb) returning an UnsubscribeFn.
// ---------------------------------------------------------------------------

export const NudgesChangedPayloadSchema = z.object({
  nudges: z.array(NudgeSchema),
})

export type NudgesChangedPayload = z.infer<typeof NudgesChangedPayloadSchema>

// ---------------------------------------------------------------------------
// summary:changed — main → renderer push event (item 0020)
//
// Emitted after each extraction cadence tick fires the summarise() call on the
// provider. Carries the latest whole-meeting plain-text running summary.
// The renderer replaces its local summary string on each event.
//
// Pattern: webContents.send('summary:changed', payload) on main;
//          ipcRenderer.on('summary:changed', listener) in preload, exposed as
//          window.api.onSummaryChanged(cb) returning an UnsubscribeFn.
// ---------------------------------------------------------------------------

export const SummaryChangedPayloadSchema = z.object({
  /** The latest whole-meeting running summary as plain text. */
  summary: z.string(),
})

export type SummaryChangedPayload = z.infer<typeof SummaryChangedPayloadSchema>

// ---------------------------------------------------------------------------
// summary:query — invoke channel (item 0020)
//
// The note-taker asks a free-form question grounded in the current transcript.
// Main calls provider.query() and returns a plain-text answer.
// If the provider has no query() method, returns { answer: '' }.
// ---------------------------------------------------------------------------

export const SummaryQueryRequestSchema = z.object({
  question: z.string().min(1, 'Question cannot be empty'),
})

export const SummaryQueryResponseSchema = z.object({
  answer: z.string(),
})

export type SummaryQueryRequest = z.infer<typeof SummaryQueryRequestSchema>
export type SummaryQueryResponse = z.infer<typeof SummaryQueryResponseSchema>

// ---------------------------------------------------------------------------
// item:confirm — note-taker confirms a Proposed Decision or Action (item 0018)
// ---------------------------------------------------------------------------

export const ItemConfirmRequestSchema = z.object({
  kind: z.enum(['decision', 'action']),
  id: z.string().min(1),
})

export const ItemConfirmResponseSchema = z.union([DecisionSchema, ActionSchema])

export type ItemConfirmRequest = z.infer<typeof ItemConfirmRequestSchema>
export type ItemConfirmResponse = z.infer<typeof ItemConfirmResponseSchema>

// ---------------------------------------------------------------------------
// item:editAndConfirm — edit + confirm in one step (item 0018)
// ---------------------------------------------------------------------------

const DecisionUpdatesSchema = z.object({
  rationale: z.string().optional(),
  agendaItemId: z.string().min(1).optional(),
})

const ActionUpdatesSchema = z.object({
  owner: z.string().min(1).optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['open', 'done']).optional(),
  agendaItemId: z.string().min(1).optional(),
})

export const ItemEditAndConfirmRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('decision'), id: z.string().min(1), updates: DecisionUpdatesSchema }),
  z.object({ kind: z.literal('action'), id: z.string().min(1), updates: ActionUpdatesSchema }),
])

export const ItemEditAndConfirmResponseSchema = z.union([DecisionSchema, ActionSchema])

export type ItemEditAndConfirmRequest = z.infer<typeof ItemEditAndConfirmRequestSchema>
export type ItemEditAndConfirmResponse = z.infer<typeof ItemEditAndConfirmResponseSchema>

// ---------------------------------------------------------------------------
// item:dismiss — note-taker dismisses a Proposed Decision or Action (item 0018)
// ---------------------------------------------------------------------------

export const ItemDismissRequestSchema = z.object({
  kind: z.enum(['decision', 'action']),
  id: z.string().min(1),
})

export const ItemDismissResponseSchema = z.object({ ok: z.literal(true) })

export type ItemDismissRequest = z.infer<typeof ItemDismissRequestSchema>
export type ItemDismissResponse = z.infer<typeof ItemDismissResponseSchema>

// ---------------------------------------------------------------------------
// item:createConfirmed — manual add during Live → directly Confirmed (item 0018)
// ---------------------------------------------------------------------------

const NewDecisionItemSchema = z.object({
  id: z.string().min(1),
  rationale: z.string(),
  agendaItemId: z.string().min(1),
  sourceSpanId: z.string().min(1),
})

const NewActionItemSchema = z.object({
  id: z.string().min(1),
  agendaItemId: z.string().min(1),
  sourceSpanId: z.string().min(1),
  owner: z.string().min(1).optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['open', 'done']),
})

export const ItemCreateConfirmedRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('decision'),
    meetingId: z.string().min(1),
    item: NewDecisionItemSchema,
  }),
  z.object({
    kind: z.literal('action'),
    meetingId: z.string().min(1),
    item: NewActionItemSchema,
  }),
])

export const ItemCreateConfirmedResponseSchema = z.union([DecisionSchema, ActionSchema])

export type ItemCreateConfirmedRequest = z.infer<typeof ItemCreateConfirmedRequestSchema>
export type ItemCreateConfirmedResponse = z.infer<typeof ItemCreateConfirmedResponseSchema>

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
  | 'item:confirm'
  | 'item:editAndConfirm'
  | 'item:dismiss'
  | 'item:createConfirmed'
  | 'summary:query'

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
  /**
   * Subscribe to proposed-item updates pushed from main.
   * Fired after every rolling extraction turn or final pass that produces ≥1
   * proposed Decision or Action. The callback receives the newly proposed items
   * for that turn; the UI merges/replaces its local proposed-item state.
   * Returns an unsubscribe function.
   * (item 0018)
   */
  onItemsChanged: (cb: (payload: ItemsChangedPayload) => void) => UnsubscribeFn
  /**
   * Subscribe to Discussion Summary events pushed from main.
   * Fired exactly once, after the final extraction pass completes (meeting end).
   * Returns an unsubscribe function.
   * (item 0018)
   */
  onItemsSummaries: (cb: (payload: ItemsSummariesPayload) => void) => UnsubscribeFn
  /**
   * Subscribe to nudge updates pushed from main (item 0019).
   * Fired after every extraction turn that may change the nudge set.
   * The callback receives the full derived nudge array; the UI replaces
   * its local nudge state.
   * Returns an unsubscribe function.
   */
  onNudgesChanged: (cb: (payload: NudgesChangedPayload) => void) => UnsubscribeFn
  /**
   * Confirm a Proposed Decision or Action (item 0018).
   * Transitions the item to Confirmed state.
   */
  itemConfirm: (req: ItemConfirmRequest) => Promise<ItemConfirmResponse>
  /**
   * Edit and confirm a Decision or Action in one step (item 0018).
   */
  itemEditAndConfirm: (req: ItemEditAndConfirmRequest) => Promise<ItemEditAndConfirmResponse>
  /**
   * Dismiss a Proposed Decision or Action (item 0018).
   * Removes the item; the agent may re-propose it if context changes.
   */
  itemDismiss: (req: ItemDismissRequest) => Promise<ItemDismissResponse>
  /**
   * Manually create a Confirmed Decision or Action during Live (item 0018).
   * Bypasses the Proposed state; the item is immediately Confirmed.
   */
  itemCreateConfirmed: (req: ItemCreateConfirmedRequest) => Promise<ItemCreateConfirmedResponse>
  /**
   * Subscribe to running summary updates pushed from main (item 0020).
   * Fired after each extraction cadence tick when summarise() produces a result.
   * The callback receives the full current running summary string; the UI
   * replaces its local summary text on each event.
   * Returns an unsubscribe function.
   */
  onSummaryChanged: (cb: (payload: SummaryChangedPayload) => void) => UnsubscribeFn
  /**
   * Ask a free-form question grounded in the current transcript (item 0020).
   * Main calls provider.query() and returns a plain-text answer.
   * Returns { answer: '' } if the provider has no query capability.
   */
  summaryQuery: (req: SummaryQueryRequest) => Promise<SummaryQueryResponse>
}
