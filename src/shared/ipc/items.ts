/**
 * Item-action IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Invoke channels: item:confirm, item:editAndConfirm, item:dismiss,
 * item:createConfirmed. Push events: items:changed, items:summaries,
 * nudges:changed.
 */

import { z } from 'zod'

import { DecisionSchema, ActionSchema, NudgeSchema, ItemStateSchema } from '../domain/types'

import type { IpcChannelSchema, UnsubscribeFn } from './common'

// Re-export the domain item schemas/types through the IPC contract so importers
// that already reach for them via `@shared/ipc` keep working.
export { DecisionSchema, ActionSchema, DiscussionSummarySchema, NudgeSchema } from '../domain/types'
export type { Decision, Action, DiscussionSummary, Nudge } from '../domain/types'

// ---------------------------------------------------------------------------
// items:changed — main → renderer push event (item 0018)
//
// Emitted after ANY item mutation (an agent extraction turn OR a note-taker IPC
// action: confirm / dismiss / edit / create). Main is authoritative: the payload
// carries the FULL current item set for `meetingId` (both Proposed and Confirmed),
// so the renderer reconciles wholesale by state rather than re-deriving
// transitions locally (ADR 0033). The renderer applies it only when `meetingId`
// matches the meeting it currently has focused.
//
// Pattern: webContents.send('items:changed', payload) on main;
//          ipcRenderer.on('items:changed', listener) in preload, exposed as
//          window.api.onItemsChanged(cb) returning an UnsubscribeFn.
// ---------------------------------------------------------------------------

export const ItemsChangedPayloadSchema = z.object({
  /** The meeting these items belong to (renderer applies only for its focused meeting). */
  meetingId: z.string().min(1),
  /**
   * Full current decisions/actions (both Proposed and Confirmed). These are the
   * domain Decision/Action shapes, derived from the domain schemas so the item
   * fields stay a single source of truth (avoids the drift the audit flagged).
   * Delta: `state` is required on the wire — main always sends it, so we drop the
   * domain schema's `.default('proposed')` (a payload missing state must reject,
   * exactly as before).
   */
  decisions: z.array(DecisionSchema.extend({ state: ItemStateSchema })),
  actions: z.array(ActionSchema.extend({ state: ItemStateSchema })),
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

// Edit payloads: a subset of the domain Decision/Action fields, all optional (a
// partial update). Derived from the domain schemas so the shared fields have a
// single source of truth. Delta: `description` keeps a min(1) constraint here (a
// note-taker edit must not blank an action) whereas the domain Action.description
// is optional-and-possibly-empty for back-compat, so it is re-declared locally.
const DecisionUpdatesSchema = DecisionSchema.pick({ rationale: true, agendaItemId: true }).partial()

const ActionUpdatesSchema = ActionSchema.pick({
  owner: true,
  dueDate: true,
  status: true,
  agendaItemId: true,
})
  .partial()
  .extend({ description: z.string().min(1).optional() })

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

// The create-confirmed payload is a full domain item minus `state`: main sets
// state = 'confirmed' itself, so the renderer never sends it. Derived from the
// domain schemas (single source of truth) rather than re-listing every field.
const NewDecisionItemSchema = DecisionSchema.omit({ state: true })

const NewActionItemSchema = ActionSchema.omit({ state: true })

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
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type ItemChannel =
  'item:confirm' | 'item:editAndConfirm' | 'item:dismiss' | 'item:createConfirmed'

export const itemChannelSchemas = {
  'item:confirm': { request: ItemConfirmRequestSchema, response: ItemConfirmResponseSchema },
  'item:editAndConfirm': {
    request: ItemEditAndConfirmRequestSchema,
    response: ItemEditAndConfirmResponseSchema,
  },
  'item:dismiss': { request: ItemDismissRequestSchema, response: ItemDismissResponseSchema },
  'item:createConfirmed': {
    request: ItemCreateConfirmedRequestSchema,
    response: ItemCreateConfirmedResponseSchema,
  },
} satisfies Record<ItemChannel, IpcChannelSchema>

export interface ItemApi {
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
}
