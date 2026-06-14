/**
 * ExtractionLoopScheduler (item 0008).
 *
 * Drives the ExtractionProvider on a debounced rolling cadence over
 * accumulating transcript spans, feeding results into ItemLifecycleService.
 * On MeetingEnded it runs the final extraction pass exactly once, which
 * also produces per-Agenda-Item Discussion Summaries.
 *
 * ## Cadence strategy
 *
 * A turn fires when EITHER:
 *   (a) The injected Clock reports that `cadenceMs` milliseconds have elapsed
 *       since the last successful turn (or since scheduler start), AND there
 *       are unsent spans pending — checked by calling `tick()`.
 *   (b) The meeting is paused — `notifyPaused()` flushes pending spans
 *       immediately, regardless of elapsed time.
 *
 * Between turns, new spans accumulate in an internal buffer. The scheduler
 * tracks a "sent index" (`_sentUpTo`) so each span is sent at most once per
 * rolling turn. A failed turn does NOT advance `_sentUpTo`; spans are retried
 * on the next tick (autosave guarantee: principle #13 means we'd rather
 * re-extract than skip a span).
 *
 * ## Final pass
 *
 * `runFinalPass()` reads ALL spans for the meeting from `transcriptSpanRepo`
 * (not just the local buffer) so that any spans persisted before the scheduler
 * was attached are also included. It sets `isFinalPass=true` and persists any
 * returned Discussion Summaries. A guard prevents a second final pass.
 *
 * ## In-flight guard
 *
 * A `_inFlight` flag prevents overlapping turns. If `tick()` is called while a
 * turn is in progress, it returns immediately. The next `tick()` after the turn
 * completes will pick up any spans that arrived in the meantime.
 *
 * ## Error handling
 *
 * Provider errors on rolling turns are caught, logged (without transcript
 * content, per principle #12), and swallowed. The turn is treated as if it
 * never happened: `_sentUpTo` is NOT advanced, so spans are retried next tick.
 * Previously proposed items are unaffected. The same applies to the final pass.
 *
 * ## 0009 seam
 *
 * Owner hints and agenda-item hints from the provider are passed through as-is
 * to `proposeItems`. Item 0009 will add the fuzzy-matching logic that resolves
 * hints against the real Participant list and AgendaItems. For now,
 * `agendaItemId` defaults to the Off-agenda sentinel and `owner` is left unset
 * when hints are not used.
 */

import { randomUUID } from 'crypto'

import type { AgendaItem, Meeting, MeetingId, Participant, TranscriptSpan } from '@shared/domain'
import { OffAgenda } from '@shared/domain'
import type {
  Clock,
  ExtractionProvider,
  ExtractionResponse,
  ProposedAction,
  ProposedDecision,
} from '@shared/providers'

import type { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import type { ItemLifecycleService, NewActionInput, NewDecisionInput } from './itemLifecycleService'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Meeting context passed to each extraction turn.
 * Callers supply agenda/participants/language once per tick; this keeps the
 * scheduler stateless about meeting metadata (it's the meeting state machine's
 * job to own those fields).
 */
export interface MeetingContext {
  agendaItems: AgendaItem[]
  participants: Participant[]
  primaryLanguage: string
}

export interface ExtractionLoopSchedulerDeps {
  provider: ExtractionProvider
  itemLifecycleService: ItemLifecycleService
  discussionSummaryRepo: ReturnType<typeof discussionSummaryRepo>
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  clock: Clock
  /**
   * Milliseconds of new transcript that must accumulate before a rolling
   * extraction turn fires. Defaults to 20 000 ms (20 s), within the
   * CONTEXT.md "rolling ~15-30s cadence" range.
   */
  cadenceMs?: number
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class ExtractionLoopScheduler {
  private readonly _provider: ExtractionProvider
  private readonly _itemService: ItemLifecycleService
  private readonly _dsRepo: ReturnType<typeof discussionSummaryRepo>
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _clock: Clock
  private readonly _cadenceMs: number

  /**
   * All spans added since the scheduler was created, in arrival order.
   * The final pass reads from `transcriptSpanRepo` directly (to catch
   * spans persisted before this scheduler attached), but rolling turns
   * use this buffer for windowing.
   */
  private readonly _buffer: TranscriptSpan[] = []

  /**
   * Index into `_buffer`: spans at [0, _sentUpTo) have been sent in a
   * prior successful rolling turn. Only spans at [_sentUpTo, ∞) are sent
   * on the next turn.
   */
  private _sentUpTo = 0

  /** Timestamp (from Clock) of the last successful rolling turn. */
  private _lastTurnAt: number

  /** True while a rolling turn is executing; prevents overlap. */
  private _inFlight = false

  /** True after the final pass has been triggered; prevents a second run. */
  private _finalPassDone = false

  constructor(deps: ExtractionLoopSchedulerDeps) {
    this._provider = deps.provider
    this._itemService = deps.itemLifecycleService
    this._dsRepo = deps.discussionSummaryRepo
    this._spanRepo = deps.spanRepo
    this._clock = deps.clock
    this._cadenceMs = deps.cadenceMs ?? 20_000
    this._lastTurnAt = this._clock.now()
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Register a new transcript span and persist it immediately (principle #13:
   * autosave). Call this each time the ASR provider emits a new span.
   *
   * Does not trigger an extraction turn on its own — the turn fires on the
   * next `tick()` that crosses the cadence boundary.
   */
  addSpan(span: TranscriptSpan, meetingId: MeetingId): void {
    this._spanRepo.insert(span, meetingId)
    this._buffer.push(span)
  }

  /**
   * Check whether the cadence boundary has been crossed and, if so, run one
   * rolling extraction turn. Call this on every ASR span arrival or on a
   * periodic heartbeat driven by the real clock.
   *
   * Safe to call frequently — it is a no-op unless:
   *   - `cadenceMs` have elapsed since the last turn, AND
   *   - there are unsent spans in the buffer, AND
   *   - no turn is currently in flight.
   */
  async tick(meetingId: MeetingId, context: MeetingContext): Promise<void> {
    if (this._inFlight) return
    if (this._buffer.length <= this._sentUpTo) return

    const elapsed = this._clock.now() - this._lastTurnAt
    if (elapsed < this._cadenceMs) return

    await this._runRollingTurn(meetingId, context)
  }

  /**
   * Flush pending spans immediately, as if the cadence boundary were hit.
   * Call when the meeting is paused: CONTEXT.md specifies "pause halts audio
   * and the cadence", so we flush any pending spans before stopping.
   *
   * No-op if there are no unsent spans.
   */
  async notifyPaused(meetingId: MeetingId, context: MeetingContext): Promise<void> {
    if (this._inFlight) return
    if (this._buffer.length <= this._sentUpTo) return

    await this._runRollingTurn(meetingId, context)
  }

  /**
   * Run the final extraction pass exactly once (called when MeetingEnded).
   *
   * The final pass reads ALL spans from `transcriptSpanRepo` (not just the
   * local buffer) to ensure spans persisted before this scheduler attached
   * are included. Sets `isFinalPass=true` so the provider also produces
   * per-Agenda-Item Discussion Summaries.
   *
   * Any Discussion Summaries in the response are persisted immediately.
   * Decisions and Actions are proposed via ItemLifecycleService as usual.
   *
   * A second call is a no-op (the guard prevents double-finalisation).
   */
  async runFinalPass(meeting: Meeting, context: MeetingContext): Promise<void> {
    if (this._finalPassDone) return
    this._finalPassDone = true

    const allSpans = this._spanRepo.listByMeeting(meeting.id)

    let response: ExtractionResponse
    try {
      response = await this._provider.extract({
        spans: allSpans,
        agendaItems: context.agendaItems,
        participants: context.participants,
        primaryLanguage: context.primaryLanguage,
        isFinalPass: true,
      })
    } catch (err) {
      logProviderError('final pass', err)
      return
    }

    // Persist Discussion Summaries first (autosave, principle #13)
    for (const ds of response.discussionSummaries ?? []) {
      this._dsRepo.insert(
        { id: randomUUID(), agendaItemId: ds.agendaItemId, text: ds.text },
        meeting.id,
      )
    }

    // Propose decisions/actions from the final pass
    this._proposeItems(meeting.id, response.proposedDecisions, response.proposedActions)
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Execute one rolling extraction turn over the unsent span window.
   * On success, advances `_sentUpTo` and resets the cadence timer.
   * On provider error, logs without exposing transcript content and leaves
   * `_sentUpTo` unchanged so the spans are retried on the next turn.
   */
  private async _runRollingTurn(meetingId: MeetingId, context: MeetingContext): Promise<void> {
    this._inFlight = true

    const windowStart = this._sentUpTo
    const windowEnd = this._buffer.length
    const spans = this._buffer.slice(windowStart, windowEnd)

    let succeeded = false
    try {
      const response = await this._provider.extract({
        spans,
        agendaItems: context.agendaItems,
        participants: context.participants,
        primaryLanguage: context.primaryLanguage,
        isFinalPass: false,
      })

      this._proposeItems(meetingId, response.proposedDecisions, response.proposedActions)
      succeeded = true
    } catch (err) {
      logProviderError('rolling turn', err)
    } finally {
      this._inFlight = false
    }

    if (succeeded) {
      // Advance the window and reset the cadence timer only on success.
      // A failed turn retries the same spans next tick.
      this._sentUpTo = windowEnd
      this._lastTurnAt = this._clock.now()
    }
  }

  /**
   * Map provider DTOs to domain inputs and call proposeItems.
   *
   * Owner hints and agenda-item hints are passed through as-is; item 0009 will
   * add the fuzzy-matching layer that resolves them. For now:
   *   - `agendaItemId` falls back to the Off-agenda sentinel when no hint is
   *     given (matching the CONTEXT.md rule: "A built-in Off-agenda bucket
   *     catches Decisions and Actions that map to no planned item").
   *   - `owner` is left undefined when no hint is given.
   */
  private _proposeItems(
    meetingId: MeetingId,
    proposedDecisions: ProposedDecision[],
    proposedActions: ProposedAction[],
  ): void {
    const decisions: NewDecisionInput[] = proposedDecisions.map((d) => ({
      id: randomUUID(),
      rationale: d.rationale,
      sourceSpanId: d.sourceSpanId,
      // 0009 seam: agendaItemHint is a raw string hint; use Off-agenda until 0009 resolves it
      agendaItemId: d.agendaItemHint ?? OffAgenda.id,
    }))

    const actions: NewActionInput[] = proposedActions.map((a) => ({
      id: randomUUID(),
      // Note: ProposedAction carries `description` from the provider, but the
      // domain Action has no description field (it is identified by sourceSpanId).
      // Item 0009 may extend the domain model; for now we map only what exists.
      sourceSpanId: a.sourceSpanId,
      agendaItemId: a.agendaItemHint ?? OffAgenda.id,
      // 0009 seam: ownerHint is a raw name hint; owner left absent until 0009 resolves it.
      // Do NOT write `owner: undefined` — exactOptionalPropertyTypes forbids it.
      status: 'open' as const,
    }))

    this._itemService.proposeItems(meetingId, { decisions, actions })
  }
}

// ---------------------------------------------------------------------------
// Logging helper — never logs transcript content (principle #12)
// ---------------------------------------------------------------------------

function logProviderError(turn: string, err: unknown): void {
  const message = err instanceof Error ? err.message : 'unknown error'
  // Deliberately log only the error message, not any request/response content
  // (which may contain transcript text).
  console.error(`[ExtractionLoopScheduler] Provider error on ${turn}: ${message}`)
}
