/**
 * LiveExtractionRuntime (item 0018 — main-process half).
 *
 * Orchestration layer connecting the ASR span stream to the extraction
 * pipeline during a live meeting. The runtime owns the full extraction
 * lifecycle for one meeting session:
 *
 *   1. Span filtering — interim spans (isFinal === false) are dropped; final
 *      spans (isFinal: true or isFinal absent per CONTEXT.md) are accepted.
 *   2. Persistence — every accepted final span is written to transcriptSpanRepo
 *      immediately (autosave, principle #13).
 *   3. Scheduler feeding — accepted spans are added to the
 *      ExtractionLoopScheduler so rolling turns pick them up.
 *   4. IPC events:
 *      - 'items:changed' is emitted after every turn (rolling or final) that
 *        produces ≥1 proposed item.
 *      - 'items:summaries' is emitted once after the final pass completes,
 *        carrying all Discussion Summaries for that meeting.
 *   5. Degraded path — if `scheduler` is null (no extraction key configured),
 *      spans are still persisted but no extraction or IPC item events occur.
 *      No crash.
 *   6. Lifecycle — `endMeeting()` triggers the scheduler's final pass exactly
 *      once. `stop()` gates further span handling.
 *
 * ## How 'items:changed' is triggered
 *
 * The ExtractionLoopScheduler calls ItemLifecycleService.proposeItems()
 * synchronously during each turn. To intercept the result without modifying
 * either of those existing services, the runtime wraps ItemLifecycleService
 * in an InterceptingItemLifecycleService whose proposeItems fires a callback
 * with the result. The scheduler is constructed with this wrapped service.
 * Both the wrapped service and the scheduler are created inside the runtime
 * so the interceptor is always in place.
 *
 * ## IPC channel design (follows ADR 0013 streaming-event pattern)
 *
 *   'items:changed'   → ItemsChangedPayload { decisions, actions }
 *   'items:summaries' → ItemsSummariesPayload { summaries }
 *
 * These channels are documented in src/shared/ipc.ts (event-only, no invoke).
 */

import type {
  Action,
  Decision,
  DiscussionSummary,
  Meeting,
  MeetingId,
  TranscriptSpan,
} from '@shared/domain'
import type { NudgesChangedPayload } from '@shared/ipc'
import { deriveNudges } from '@shared/nudges/deriveNudges'

import type { IpcSender } from '../audio/AudioCaptureBridge'
import type { actionRepo } from '../db/repos/actionRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'
import type { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import {
  ExtractionLoopScheduler,
  type MeetingContext,
  type ExtractionLoopSchedulerDeps,
} from './extractionLoopScheduler'
import {
  ItemLifecycleService,
  type ProposeItemsInput,
  type ProposeItemsResult,
} from './itemLifecycleService'

// ---------------------------------------------------------------------------
// Public payload types — cross the IPC boundary, Zod-validated in ipc.ts
// ---------------------------------------------------------------------------

export interface ItemsChangedPayload {
  decisions: Decision[]
  actions: Action[]
}

export interface ItemsSummariesPayload {
  summaries: DiscussionSummary[]
}

// ---------------------------------------------------------------------------
// InterceptingItemLifecycleService
// ---------------------------------------------------------------------------

/**
 * Subclass of ItemLifecycleService that fires `onProposed` after each
 * proposeItems call that returns ≥1 item.
 *
 * Extends (not wraps) because ItemLifecycleService is a concrete class with
 * private members; TypeScript's `implements` cannot satisfy those. The
 * override is minimal: call super.proposeItems(), check the result, fire
 * the callback when items were proposed. All other public methods are
 * inherited from the base class unchanged.
 *
 * The caller passes the same repos it would pass to ItemLifecycleService
 * directly, so the base-class DB wiring is identical to a plain service.
 */
class InterceptingItemLifecycleService extends ItemLifecycleService {
  private readonly _onProposed: (result: ProposeItemsResult) => void

  constructor(
    decisionsRepo: ReturnType<typeof decisionRepo>,
    actionsRepo: ReturnType<typeof actionRepo>,
    onProposed: (result: ProposeItemsResult) => void,
  ) {
    super(decisionsRepo, actionsRepo)
    this._onProposed = onProposed
  }

  override proposeItems(meetingId: MeetingId, input: ProposeItemsInput): ProposeItemsResult {
    const result = super.proposeItems(meetingId, input)
    if (result.decisions.length > 0 || result.actions.length > 0) {
      this._onProposed(result)
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Runtime options
// ---------------------------------------------------------------------------

/**
 * Deps for building the internal ExtractionLoopScheduler.
 * `itemLifecycleService` is omitted because the runtime builds the
 * intercepting variant internally from the repos below.
 */
export type SchedulerDeps = Omit<ExtractionLoopSchedulerDeps, 'itemLifecycleService'>

export interface LiveExtractionRuntimeOptions {
  meetingId: MeetingId
  context: MeetingContext
  /**
   * Deps to construct the scheduler. The runtime builds the scheduler
   * internally so it can wire in the intercepting item service.
   * Pass null when no extraction provider is configured (degraded path).
   */
  schedulerDeps: SchedulerDeps | null
  /**
   * Decision and Action repos used to build the intercepting item lifecycle
   * service. The runtime constructs the service (and its intercepting subclass)
   * from these repos rather than accepting a pre-built service, because
   * ItemLifecycleService is a concrete class that cannot be extended via
   * composition (its private members are not accessible externally).
   */
  decisionsRepo: ReturnType<typeof decisionRepo>
  actionsRepo: ReturnType<typeof actionRepo>
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  dsRepo: ReturnType<typeof discussionSummaryRepo>
  sender: IpcSender
  /**
   * When the meeting started (used for the EmptyAgendaItem nudge heuristic).
   * Defaults to the time the runtime was constructed when not provided.
   */
  meetingStartedAt?: Date
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class LiveExtractionRuntime {
  private readonly _meetingId: MeetingId
  private readonly _context: MeetingContext
  /** Null when no extraction provider configured (degraded path). */
  private readonly _scheduler: ExtractionLoopScheduler | null
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _dsRepo: ReturnType<typeof discussionSummaryRepo>
  private readonly _decisionsRepo: ReturnType<typeof decisionRepo>
  private readonly _actionsRepo: ReturnType<typeof actionRepo>
  private readonly _sender: IpcSender
  private readonly _meetingStartedAt: Date

  private _stopped = false
  private _endMeetingCalled = false

  constructor(opts: LiveExtractionRuntimeOptions) {
    this._meetingId = opts.meetingId
    this._context = opts.context
    this._spanRepo = opts.spanRepo
    this._dsRepo = opts.dsRepo
    this._decisionsRepo = opts.decisionsRepo
    this._actionsRepo = opts.actionsRepo
    this._sender = opts.sender
    this._meetingStartedAt = opts.meetingStartedAt ?? new Date()

    if (opts.schedulerDeps !== null) {
      // Build the intercepting item service from the repos.
      // The interceptor fires 'items:changed' whenever proposeItems produces items.
      const wrappedService = new InterceptingItemLifecycleService(
        opts.decisionsRepo,
        opts.actionsRepo,
        (result) => {
          this._sender.send('items:changed', {
            decisions: result.decisions,
            actions: result.actions,
          } satisfies ItemsChangedPayload)
          this._emitNudges()
        },
      )
      this._scheduler = new ExtractionLoopScheduler({
        ...opts.schedulerDeps,
        itemLifecycleService: wrappedService,
      })
    } else {
      // Degraded path: no extraction provider — keep transcription + persistence
      this._scheduler = null
      console.warn(
        '[LiveExtractionRuntime] No extraction provider configured. ' +
          'Transcript spans will be persisted but live extraction is disabled. ' +
          'Configure an extraction API key in Settings to enable item extraction.',
      )
    }
  }

  // -------------------------------------------------------------------------
  // Nudge derivation (item 0019)
  // -------------------------------------------------------------------------

  /**
   * Derive nudges from the current meeting state and emit 'nudges:changed'.
   * Called after every 'items:changed' emission so the renderer stays in sync.
   */
  private _emitNudges(): void {
    const decisions = this._decisionsRepo.listByMeeting(this._meetingId)
    const actions = this._actionsRepo.listActionsByMeeting(this._meetingId)
    const spans = this._spanRepo.listByMeeting(this._meetingId)
    const nudges = deriveNudges(
      {
        decisions,
        actions,
        agendaItems: this._context.agendaItems,
        participants: this._context.participants,
        transcriptSpans: spans,
        meetingStartedAt: this._meetingStartedAt,
      },
      new Date(),
    )
    this._sender.send('nudges:changed', { nudges } satisfies NudgesChangedPayload)
  }

  // -------------------------------------------------------------------------
  // Span ingestion
  // -------------------------------------------------------------------------

  /**
   * Accept a transcript span from the ASR provider.
   *
   * Drops interim spans (isFinal === false). Persists and feeds final spans
   * to the scheduler buffer.
   */
  handleSpan(span: TranscriptSpan): void {
    if (this._stopped) return

    // Drop interim spans — CONTEXT.md: "only isFinal !== false spans feed extraction"
    if (span.isFinal === false) return

    if (this._scheduler !== null) {
      // The scheduler's addSpan() persists to the spanRepo and buffers for the
      // next extraction turn — both in one call (autosave, principle #13).
      this._scheduler.addSpan(span, this._meetingId)
    } else {
      // Degraded path: no scheduler, but spans must still be persisted.
      this._spanRepo.insert(span, this._meetingId)
    }
  }

  // -------------------------------------------------------------------------
  // Cadence tick
  // -------------------------------------------------------------------------

  /**
   * Drive one scheduler tick. No-op when stopped or no scheduler configured.
   * If the tick produces proposed items, 'items:changed' is emitted via the
   * intercepting item service inside the scheduler.
   */
  async tick(): Promise<void> {
    if (this._stopped) return
    if (this._scheduler === null) return

    await this._scheduler.tick(this._meetingId, this._context)
  }

  // -------------------------------------------------------------------------
  // Meeting end
  // -------------------------------------------------------------------------

  /**
   * Trigger the final extraction pass and emit 'items:summaries'.
   * Guarded — a second call is a no-op.
   */
  async endMeeting(meeting: Meeting): Promise<void> {
    if (this._endMeetingCalled) return
    this._endMeetingCalled = true

    if (this._scheduler === null) return

    // The scheduler's runFinalPass persists Discussion Summaries to dsRepo
    // and calls proposeItems (which triggers items:changed via the interceptor
    // if items were proposed).
    await this._scheduler.runFinalPass(meeting, this._context)

    // Read back the summaries the scheduler persisted and emit items:summaries.
    const summaries = this._dsRepo.listByMeeting(this._meetingId)
    this._sender.send('items:summaries', { summaries } satisfies ItemsSummariesPayload)

    // Re-derive nudges after the final pass (items may have changed).
    this._emitNudges()
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Stop the runtime. After this, handleSpan() and tick() are no-ops. */
  stop(): void {
    this._stopped = true
  }
}
