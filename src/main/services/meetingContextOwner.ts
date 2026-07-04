/**
 * MeetingContextOwner — the single owner of one live meeting's MeetingContext
 * (review item 5b).
 *
 * The context (agenda items, participants, primary language) used to be seeded,
 * mutated in place, and re-derived inline in LiveExtractionRuntime (`_context` +
 * `_liveRoutingContext`), with no single home. This owns all three:
 *
 *   - `current()`        — the full context (fed to the final pass and nudges).
 *   - `routingContext()` — the Confirmed-agenda-only view a live rolling turn
 *                          routes into: Decisions/Actions may attach only to
 *                          Confirmed agenda items + the Off-agenda bucket during
 *                          Live (ADR 0029), so Proposed items the agent inferred
 *                          are not yet routing targets. Falls back to the static
 *                          context when no agenda repo is wired.
 *   - `enrich()`         — replace agenda + participants after the final pass
 *                          infers them, keeping the primary language.
 *
 * It does NOT touch the meeting title — that is a meetingRepo concern the runtime
 * keeps.
 */

import type { AgendaItem, MeetingId, Participant } from '@shared/domain'

import type { agendaItemRepo } from '../db/repos/agendaItemRepo'

import type { MeetingContext } from './extractionLoopScheduler'

export class MeetingContextOwner {
  private _context: MeetingContext
  private readonly _meetingId: MeetingId
  private readonly _agendaItemRepo: ReturnType<typeof agendaItemRepo> | undefined

  constructor(
    seed: MeetingContext,
    meetingId: MeetingId,
    agendaRepo?: ReturnType<typeof agendaItemRepo>,
  ) {
    this._context = seed
    this._meetingId = meetingId
    this._agendaItemRepo = agendaRepo
  }

  /** The full current context (final pass + nudges). */
  current(): MeetingContext {
    return this._context
  }

  /**
   * Context for a live rolling turn: the Confirmed agenda items from the repo
   * (ADR 0029). Falls back to the static context when no agenda repo is wired.
   */
  routingContext(): MeetingContext {
    if (this._agendaItemRepo === undefined) return this._context
    const confirmed = this._agendaItemRepo
      .listByMeeting(this._meetingId)
      .filter((a) => a.state === 'confirmed')
    return { ...this._context, agendaItems: confirmed }
  }

  /** Replace agenda + participants (final-pass inference), keeping primaryLanguage. */
  enrich(update: { agendaItems: AgendaItem[]; participants: Participant[] }): void {
    this._context = {
      ...this._context,
      agendaItems: update.agendaItems,
      participants: update.participants,
    }
  }
}
