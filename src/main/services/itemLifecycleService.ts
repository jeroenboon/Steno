/**
 * ItemLifecycleService (item 0007).
 *
 * Manages the Proposed → Confirmed lifecycle of Decisions and Actions.
 *
 * Rules (from CONTEXT.md "Proposed / Confirmed"):
 *   - The Extraction Provider only ever creates items as Proposed.
 *   - The note-taker confirms, dismisses, or edits-then-confirms.
 *   - The agent may revise or retract its own Proposed items but NEVER alters
 *     a Confirmed item.
 *   - A manual create during Live yields a Confirmed item directly.
 *
 * Both Decisions and Actions share the same two-state lifecycle. Logic is
 * shared via typed private helpers; the public API is strictly typed per entity
 * with no `any`.
 */

import type { Decision, Action, ItemState, MeetingId } from '@shared/domain'

import type { actionRepo } from '../db/repos/actionRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'

// ---------------------------------------------------------------------------
// Input shapes (omit `state`; the service always sets it)
// ---------------------------------------------------------------------------

export type NewDecisionInput = Omit<Decision, 'state'>
export type NewActionInput = Omit<Action, 'state'>

export type DecisionUpdates = Partial<Omit<Decision, 'id' | 'state'>>
export type ActionUpdates = Partial<Omit<Action, 'id' | 'state'>>

export interface ProposeItemsInput {
  decisions: NewDecisionInput[]
  actions: NewActionInput[]
}

export interface ProposeItemsResult {
  decisions: Decision[]
  actions: Action[]
}

// ---------------------------------------------------------------------------
// Discriminated union for operations that work on either kind
// ---------------------------------------------------------------------------

export type ItemRef = { kind: 'decision'; id: string } | { kind: 'action'; id: string }

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ItemLifecycleService {
  private readonly decisions: ReturnType<typeof decisionRepo>
  private readonly actions: ReturnType<typeof actionRepo>
  /**
   * Optional notify seam fired with the affected meeting after any mutation that
   * changes item data. Main wires this to emit the authoritative `items:changed`
   * for that meeting (the full current item set), making main the single source
   * of truth for both the agent and the note-taker IPC paths (ADR 0033). It
   * replaced the former `InterceptingItemLifecycleService` subclass, which only
   * existed because this concrete class exposed no such hook.
   */
  private readonly onItemsChanged: ((meetingId: MeetingId) => void) | undefined

  constructor(
    decisions: ReturnType<typeof decisionRepo>,
    actions: ReturnType<typeof actionRepo>,
    onItemsChanged?: (meetingId: MeetingId) => void,
  ) {
    this.decisions = decisions
    this.actions = actions
    this.onItemsChanged = onItemsChanged
  }

  // -------------------------------------------------------------------------
  // proposeItems — agent creates new Proposed items
  // -------------------------------------------------------------------------

  proposeItems(meetingId: MeetingId, input: ProposeItemsInput): ProposeItemsResult {
    const decisions: Decision[] = input.decisions.map((d) => {
      const item: Decision = { ...d, state: 'proposed' }
      this.decisions.insert(item, meetingId)
      return item
    })

    const actions: Action[] = input.actions.map((a) => {
      const item: Action = { ...a, state: 'proposed' }
      this.actions.insert(item, meetingId)
      return item
    })

    const result: ProposeItemsResult = { decisions, actions }
    if (decisions.length > 0 || actions.length > 0) {
      this.notify(meetingId)
    }
    return result
  }

  // -------------------------------------------------------------------------
  // reviseProposed — agent updates its own still-Proposed item
  // -------------------------------------------------------------------------

  reviseProposedDecision(id: string, updates: DecisionUpdates): Decision {
    const item = this.loadDecision(id)
    this.guardProposed(item.state, 'decision', id)
    const updated: Decision = { ...item, ...updates, state: 'proposed' }
    this.decisions.update(updated)
    this.notify(this.decisions.findMeetingId(id))
    return updated
  }

  reviseProposedAction(id: string, updates: ActionUpdates): Action {
    const item = this.loadAction(id)
    this.guardProposed(item.state, 'action', id)
    const updated: Action = { ...item, ...updates, state: 'proposed' }
    this.actions.update(updated)
    this.notify(this.actions.findMeetingId(id))
    return updated
  }

  // -------------------------------------------------------------------------
  // retractProposed — agent removes a still-Proposed item
  // -------------------------------------------------------------------------

  retractProposed(ref: ItemRef): void {
    // Resolve the meeting before the delete removes the row.
    const meetingId = this.meetingIdOf(ref)
    if (ref.kind === 'decision') {
      const item = this.loadDecision(ref.id)
      this.guardProposed(item.state, 'decision', ref.id)
      this.decisions.delete(ref.id)
    } else {
      const item = this.loadAction(ref.id)
      this.guardProposed(item.state, 'action', ref.id)
      this.actions.delete(ref.id)
    }
    this.notify(meetingId)
  }

  // -------------------------------------------------------------------------
  // retractAllProposed — supersede every still-Proposed item of a meeting
  //
  // Used by the final extraction pass, which re-extracts the whole transcript
  // and is authoritative over it. Retracting the still-Proposed rolling items
  // first prevents the same content appearing twice (e.g. once under Off-agenda
  // from a live turn, once under its agenda item from the final pass). Confirmed
  // items the note-taker already curated are left untouched.
  // -------------------------------------------------------------------------

  retractAllProposed(meetingId: MeetingId): void {
    const decisions = this.decisions.listByMeeting(meetingId).filter((d) => d.state === 'proposed')
    const actions = this.actions.listByMeeting(meetingId).filter((a) => a.state === 'proposed')
    for (const d of decisions) this.decisions.delete(d.id)
    for (const a of actions) this.actions.delete(a.id)
    if (decisions.length > 0 || actions.length > 0) this.notify(meetingId)
  }

  // -------------------------------------------------------------------------
  // confirm — note-taker confirms a Proposed item → Confirmed
  // -------------------------------------------------------------------------

  confirm(ref: ItemRef): Decision | Action {
    if (ref.kind === 'decision') {
      const item = this.loadDecision(ref.id)
      const updated: Decision = { ...item, state: 'confirmed' }
      this.decisions.update(updated)
      this.notify(this.decisions.findMeetingId(ref.id))
      return updated
    } else {
      const item = this.loadAction(ref.id)
      const updated: Action = { ...item, state: 'confirmed' }
      this.actions.update(updated)
      this.notify(this.actions.findMeetingId(ref.id))
      return updated
    }
  }

  // -------------------------------------------------------------------------
  // editAndConfirm — note-taker edits then confirms in one step
  // -------------------------------------------------------------------------

  editAndConfirmDecision(id: string, updates: DecisionUpdates): Decision {
    const item = this.loadDecision(id)
    const updated: Decision = { ...item, ...updates, state: 'confirmed' }
    this.decisions.update(updated)
    this.notify(this.decisions.findMeetingId(id))
    return updated
  }

  editAndConfirmAction(id: string, updates: ActionUpdates): Action {
    const item = this.loadAction(id)
    const updated: Action = { ...item, ...updates, state: 'confirmed' }
    this.actions.update(updated)
    this.notify(this.actions.findMeetingId(id))
    return updated
  }

  // -------------------------------------------------------------------------
  // dismiss — note-taker removes a Proposed item
  // -------------------------------------------------------------------------

  dismiss(ref: ItemRef): void {
    // Resolve the meeting before the delete removes the row.
    const meetingId = this.meetingIdOf(ref)
    if (ref.kind === 'decision') {
      const item = this.loadDecision(ref.id)
      this.guardProposed(item.state, 'decision', ref.id)
      this.decisions.delete(ref.id)
    } else {
      const item = this.loadAction(ref.id)
      this.guardProposed(item.state, 'action', ref.id)
      this.actions.delete(ref.id)
    }
    this.notify(meetingId)
  }

  // -------------------------------------------------------------------------
  // createConfirmed — manual add during Live → directly Confirmed
  // -------------------------------------------------------------------------

  createConfirmedDecision(meetingId: MeetingId, input: NewDecisionInput): Decision {
    const item: Decision = { ...input, state: 'confirmed' }
    this.decisions.insert(item, meetingId)
    this.notify(meetingId)
    return item
  }

  createConfirmedAction(meetingId: MeetingId, input: NewActionInput): Action {
    const item: Action = { ...input, state: 'confirmed' }
    this.actions.insert(item, meetingId)
    this.notify(meetingId)
    return item
  }

  // -------------------------------------------------------------------------
  // editConfirmed — explicit user edit of a Confirmed item (user action only)
  //
  // This is the only path where a Confirmed item may be changed. It is
  // deliberately named to make clear it is a user action, not an agent action.
  // -------------------------------------------------------------------------

  editConfirmedDecision(id: string, updates: DecisionUpdates): Decision {
    const item = this.loadDecision(id)
    this.guardConfirmed(item.state, 'decision', id)
    const updated: Decision = { ...item, ...updates, state: 'confirmed' }
    this.decisions.update(updated)
    this.notify(this.decisions.findMeetingId(id))
    return updated
  }

  editConfirmedAction(id: string, updates: ActionUpdates): Action {
    const item = this.loadAction(id)
    this.guardConfirmed(item.state, 'action', id)
    const updated: Action = { ...item, ...updates, state: 'confirmed' }
    this.actions.update(updated)
    this.notify(this.actions.findMeetingId(id))
    return updated
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Fire the notify seam with the meeting, unless the meeting is unknown. */
  private notify(meetingId: MeetingId | null): void {
    if (this.onItemsChanged !== undefined && meetingId !== null) {
      this.onItemsChanged(meetingId)
    }
  }

  /** Resolve the meeting an item ref belongs to, or null when unknown. */
  private meetingIdOf(ref: ItemRef): MeetingId | null {
    return ref.kind === 'decision'
      ? this.decisions.findMeetingId(ref.id)
      : this.actions.findMeetingId(ref.id)
  }

  private loadDecision(id: string): Decision {
    const item = this.decisions.findById(id)
    if (item === null) throw new Error(`Decision not found: "${id}".`)
    return item
  }

  private loadAction(id: string): Action {
    const item = this.actions.findById(id)
    if (item === null) throw new Error(`Action not found: "${id}".`)
    return item
  }

  /**
   * Enforces the core rule: agent operations may only touch Proposed items.
   * Throws if the item is already Confirmed.
   */
  private guardProposed(state: ItemState, kind: string, id: string): void {
    if (state === 'confirmed') {
      throw new Error(
        `Cannot modify ${kind} "${id}": item is already Confirmed. ` +
          `Agent operations (revise, retract, dismiss) may only act on Proposed items.`,
      )
    }
  }

  /**
   * Enforces that editConfirmed only applies to Confirmed items.
   * Throws if the item is still Proposed.
   */
  private guardConfirmed(state: ItemState, kind: string, id: string): void {
    if (state === 'proposed') {
      throw new Error(
        `Cannot editConfirmed ${kind} "${id}": item is still Proposed. ` +
          `Use editAndConfirm to edit and transition in one step.`,
      )
    }
  }
}
