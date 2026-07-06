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
 * synchronously during each turn. The runtime constructs the service with its
 * `onItemsChanged` seam wired to push the authoritative full item set for the
 * meeting (ADR 0033), then builds the scheduler over that same service, so the
 * IPC push is always in place. This is the callback idiom AgendaInferenceScheduler
 * already uses.
 *
 * ## IPC channel design (follows ADR 0013 streaming-event pattern)
 *
 *   'items:changed'   → ItemsChangedPayload { meetingId, decisions, actions }
 *   'items:summaries' → ItemsSummariesPayload { summaries }
 *
 * These channels are documented in src/shared/ipc.ts (event-only, no invoke).
 */

import { isTitleCovered } from '@shared/agenda/agendaTitle'
import type {
  Action,
  Decision,
  DiscussionSummary,
  Meeting,
  MeetingId,
  TranscriptSpan,
} from '@shared/domain'
import type { AgendaChangedPayload, NudgesChangedPayload, SummaryChangedPayload } from '@shared/ipc'
import { deriveNudges } from '@shared/nudges/deriveNudges'
import type { ExtractionProvider } from '@shared/providers'

import type { IpcSender } from '../audio/AudioCaptureBridge'
import type { actionRepo } from '../db/repos/actionRepo'
import type { agendaItemRepo } from '../db/repos/agendaItemRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'
import type { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import type { meetingRepo } from '../db/repos/meetingRepo'
import type { participantRepo } from '../db/repos/participantRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import { AgendaInferenceScheduler } from './agendaInferenceScheduler'
import { AgendaProposalService } from './agendaProposalService'
import {
  ExtractionLoopScheduler,
  type MeetingContext,
  type ExtractionLoopSchedulerDeps,
} from './extractionLoopScheduler'
import { persistInferredContext } from './inferredContextPersistence'
import { ItemLifecycleService } from './itemLifecycleService'
import { sendItemsChanged } from './itemsChangedNotifier'
import { MeetingContextOwner } from './meetingContextOwner'

// ---------------------------------------------------------------------------
// Public payload types — cross the IPC boundary, Zod-validated in ipc.ts
// ---------------------------------------------------------------------------

export interface ItemsChangedPayload {
  /** The meeting these items belong to. */
  meetingId: MeetingId
  /** Full current decisions for the meeting (both Proposed and Confirmed). */
  decisions: Decision[]
  /** Full current actions for the meeting (both Proposed and Confirmed). */
  actions: Action[]
}

export interface ItemsSummariesPayload {
  summaries: DiscussionSummary[]
}

// ---------------------------------------------------------------------------
// Runtime options
// ---------------------------------------------------------------------------

/**
 * Deps for building the internal ExtractionLoopScheduler.
 * `itemLifecycleService` is omitted because the runtime builds the service
 * internally from the repos below (wiring its onItemsChanged seam).
 */
export type SchedulerDeps = Omit<ExtractionLoopSchedulerDeps, 'itemLifecycleService'>

export interface LiveExtractionRuntimeOptions {
  meetingId: MeetingId
  context: MeetingContext
  /**
   * Deps to construct the scheduler. The runtime builds the scheduler
   * internally so it can wire the item service's onItemsChanged seam.
   * Pass null when no extraction provider is configured (degraded path).
   */
  schedulerDeps: SchedulerDeps | null
  /**
   * Decision and Action repos used to build the item lifecycle service. The
   * runtime constructs the service from these repos (wiring its onItemsChanged
   * seam to emit `items:changed`) rather than accepting a pre-built one, so the
   * scheduler and the IPC push share a single service instance.
   */
  decisionsRepo: ReturnType<typeof decisionRepo>
  actionsRepo: ReturnType<typeof actionRepo>
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  dsRepo: ReturnType<typeof discussionSummaryRepo>
  /**
   * Repos used by the final pass to infer + persist the agenda, participants
   * and title for an un-prepared live meeting (ADR 0029). Optional: when absent
   * the final pass skips inference (e.g. the import path, which infers itself).
   */
  agendaItemRepo?: ReturnType<typeof agendaItemRepo>
  participantRepo?: ReturnType<typeof participantRepo>
  meetingRepo?: ReturnType<typeof meetingRepo>
  /**
   * Cadence (ms) for the slow live agenda inference scheduler (ADR 0029).
   * Defaults to the scheduler's own default. Only armed when an extraction
   * provider and an agendaItemRepo are both present.
   */
  agendaCadenceMs?: number
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
  /** Owns the MeetingContext: current, Confirmed-only routing view, and enrich. */
  private readonly _contextOwner: MeetingContextOwner
  /** Null when no extraction provider configured (degraded path). */
  private readonly _scheduler: ExtractionLoopScheduler | null
  /** Slow live agenda inference scheduler; null when not armed (ADR 0029). */
  private readonly _agendaScheduler: AgendaInferenceScheduler | null
  /** The extraction provider, or null when degraded. Used for summarise/query. */
  private readonly _provider: ExtractionProvider | null
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _dsRepo: ReturnType<typeof discussionSummaryRepo>
  private readonly _decisionsRepo: ReturnType<typeof decisionRepo>
  private readonly _actionsRepo: ReturnType<typeof actionRepo>
  private readonly _agendaItemRepo: ReturnType<typeof agendaItemRepo> | undefined
  private readonly _participantRepo: ReturnType<typeof participantRepo> | undefined
  private readonly _meetingRepo: ReturnType<typeof meetingRepo> | undefined
  private readonly _sender: IpcSender
  private readonly _meetingStartedAt: Date

  private _stopped = false
  private _paused = false
  private _endMeetingCalled = false
  /** Latest running summary — in-memory only, not persisted. */
  private _runningSummary = ''

  constructor(opts: LiveExtractionRuntimeOptions) {
    this._meetingId = opts.meetingId
    this._contextOwner = new MeetingContextOwner(opts.context, opts.meetingId, opts.agendaItemRepo)
    this._spanRepo = opts.spanRepo
    this._dsRepo = opts.dsRepo
    this._decisionsRepo = opts.decisionsRepo
    this._actionsRepo = opts.actionsRepo
    this._agendaItemRepo = opts.agendaItemRepo
    this._participantRepo = opts.participantRepo
    this._meetingRepo = opts.meetingRepo
    this._sender = opts.sender
    this._meetingStartedAt = opts.meetingStartedAt ?? new Date()

    if (opts.schedulerDeps !== null) {
      // Store provider reference for summarise/query
      this._provider = opts.schedulerDeps.provider

      // Build the item lifecycle service with the onItemsChanged seam wired to
      // push the authoritative full item set for the meeting (ADR 0033). This is
      // the same callback idiom AgendaInferenceScheduler uses below.
      const itemService = new ItemLifecycleService(
        opts.decisionsRepo,
        opts.actionsRepo,
        (meetingId) => {
          sendItemsChanged(this._sender, meetingId, opts.decisionsRepo, opts.actionsRepo)
          this._emitNudges()
        },
      )
      this._scheduler = new ExtractionLoopScheduler({
        ...opts.schedulerDeps,
        itemLifecycleService: itemService,
      })

      // Arm the slow live agenda inference scheduler when an agenda repo is
      // wired (ADR 0029). It shares the runtime's span store and clock — no
      // second source of truth. Absent repo ⇒ no live agenda inference.
      if (opts.agendaItemRepo !== undefined) {
        const agendaRepo = opts.agendaItemRepo
        this._agendaScheduler = new AgendaInferenceScheduler({
          provider: opts.schedulerDeps.provider,
          proposalService: new AgendaProposalService({ agendaItemRepo: agendaRepo }),
          spanRepo: opts.spanRepo,
          agendaItemRepo: agendaRepo,
          clock: opts.schedulerDeps.clock,
          ...(opts.agendaCadenceMs !== undefined ? { cadenceMs: opts.agendaCadenceMs } : {}),
          // Push the full current agenda to the renderer when new items appear.
          onProposed: () => {
            this._sender.send('agenda:changed', {
              agendaItems: agendaRepo.listByMeeting(this._meetingId),
            } satisfies AgendaChangedPayload)
          },
        })
      } else {
        this._agendaScheduler = null
      }
    } else {
      // Degraded path: no extraction provider — keep transcription + persistence
      this._provider = null
      this._scheduler = null
      this._agendaScheduler = null
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
    const actions = this._actionsRepo.listByMeeting(this._meetingId)
    const spans = this._spanRepo.listByMeeting(this._meetingId)
    const context = this._contextOwner.current()
    const nudges = deriveNudges(
      {
        decisions,
        actions,
        agendaItems: context.agendaItems,
        participants: context.participants,
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
   * item service's onItemsChanged seam inside the scheduler.
   *
   * Also triggers the running summary update when the scheduler fired a turn.
   */
  async tick(): Promise<void> {
    if (this._stopped || this._paused) return
    if (this._scheduler === null) return

    await this._scheduler.tick(this._meetingId, this._contextOwner.routingContext())
    await this._agendaScheduler?.tick(this._meetingId)
    await this._runSummary()
  }

  /**
   * Pause the live cadence (the meeting pause halts audio and the cadence,
   * CONTEXT.md). tick() becomes a no-op and the slow agenda scheduler halts
   * until resume().
   */
  pause(): void {
    this._paused = true
    this._agendaScheduler?.pause()
  }

  /** Resume the live cadence after a pause. */
  resume(): void {
    this._paused = false
    this._agendaScheduler?.resume()
  }

  // -------------------------------------------------------------------------
  // Running summary (item 0020)
  // -------------------------------------------------------------------------

  /**
   * Call provider.summarise() with all persisted final spans and emit
   * 'summary:changed' if the result is non-empty.
   *
   * Failures are caught and logged — the meeting continues uninterrupted and
   * the last known summary is retained (principle: degrade, never crash).
   */
  private async _runSummary(): Promise<void> {
    if (this._provider?.summarise === undefined) return

    const spans = this._spanRepo.listByMeeting(this._meetingId)
    if (spans.length === 0) return

    try {
      const summary = await this._provider.summarise(spans)
      if (summary.length > 0) {
        this._runningSummary = summary
        this._sender.send('summary:changed', { summary } satisfies SummaryChangedPayload)
      }
    } catch (err) {
      // Never log transcript content; only a non-sensitive metadata note.
      console.error(
        '[LiveExtractionRuntime] summarise() failed, retaining last summary:',
        err instanceof Error ? err.message : 'unknown error',
      )
    }
  }

  /**
   * Answer a free-form question grounded in the current transcript.
   * Returns '' when no provider or when provider lacks query() capability.
   *
   * Called by the IPC handler for 'summary:query'.
   */
  async querySummary(question: string): Promise<string> {
    if (this._provider?.query === undefined) return ''
    const spans = this._spanRepo.listByMeeting(this._meetingId)
    if (spans.length === 0) return ''
    return this._provider.query(spans, question)
  }

  /** Return the current in-memory running summary. */
  get runningSummary(): string {
    return this._runningSummary
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

    if (this._scheduler === null) {
      this._endMeetingCalled = true
      return
    }

    // Stop the slow agenda scheduler before the final pass so it can't fire a
    // late inference turn concurrently with (or after) finalisation.
    this._agendaScheduler?.pause()

    // Un-prepared live meeting (quick-start / agenda spoken at the top): infer
    // the agenda, participants and title over the whole transcript before the
    // final pass, so the notes still get a structured, agenda-grouped result
    // (ADR 0029). Import meetings infer themselves, so this is live-only.
    //
    // Best-effort: inference is a network call, and a transient failure (429,
    // timeout, expired key) must NOT strand the meeting at finalisation. Degrade
    // to no inferred context — the final pass below still runs (it degrades on
    // its own provider errors too) and the caller still transitions Live → Ended.
    try {
      await this._inferContextOnEnd(meeting)
    } catch (err) {
      // Never log transcript content; only a non-sensitive metadata note.
      console.error(
        '[LiveExtractionRuntime] context inference failed at meeting end, ' +
          'continuing with the final pass without inferred context:',
        err instanceof Error ? err.message : 'unknown error',
      )
    }

    // The scheduler's runFinalPass persists Discussion Summaries to dsRepo
    // and calls proposeItems (which triggers items:changed via the interceptor
    // if items were proposed).
    await this._scheduler.runFinalPass(meeting, this._contextOwner.current())

    // Push the authoritative agenda to the renderer. The final pass routes its
    // items (and summaries) onto the agenda it inferred/enriched, but the live
    // agenda:changed stream stopped when the meeting ended — without this, Review
    // reads a stale/empty agenda from the store and the routed items land under
    // groups the renderer doesn't have, so they silently vanish.
    if (this._agendaItemRepo !== undefined) {
      this._sender.send('agenda:changed', {
        agendaItems: this._agendaItemRepo.listByMeeting(this._meetingId),
      } satisfies AgendaChangedPayload)
    }

    // Read back the summaries the scheduler persisted and emit items:summaries.
    const summaries = this._dsRepo.listByMeeting(this._meetingId)
    this._sender.send('items:summaries', { summaries } satisfies ItemsSummariesPayload)

    // Re-derive nudges after the final pass (items may have changed).
    this._emitNudges()

    // Latch ONLY on success. Setting this eagerly at entry meant a rejection
    // before the final pass (e.g. inferContext throwing) marked endMeeting "done"
    // while the final pass never ran, so a retry short-circuited and the meeting
    // ended with no notes (audit C2). Latching here — after the final pass — makes
    // a retry re-run it instead. The scheduler's own `_finalPassDone` guard still
    // prevents a genuine double pass, so the two guards compose safely.
    this._endMeetingCalled = true
  }

  /**
   * Infer the agenda, participants and (optional) title for an un-prepared live
   * meeting, persist the agenda items as Proposed and the participants, enrich
   * the in-memory context so the final pass routes into the inferred agenda, and
   * replace an auto-generated title (clearing the flag). No-op unless the meeting
   * is live, its agenda is empty, the provider can infer, and the repos are
   * wired (the import path infers itself). See ADR 0029.
   */
  private async _inferContextOnEnd(meeting: Meeting): Promise<void> {
    if (meeting.source !== 'live') return
    if (this._contextOwner.current().agendaItems.length > 0) return
    if (
      this._provider?.inferContext === undefined ||
      this._agendaItemRepo === undefined ||
      this._participantRepo === undefined
    ) {
      return
    }

    const spans = this._spanRepo.listByMeeting(this._meetingId)
    if (spans.length === 0) return

    // Ground the inference on what the repo already holds — the agenda items live
    // inference proposed during the meeting, and any participants. Without this,
    // `excludeCoveredAgendaItems` has nothing to exclude and the final pass appends
    // a second copy of the whole live-inferred agenda (the "agenda 2x" bug).
    const existingAgenda = this._agendaItemRepo.listByMeeting(this._meetingId)
    const existingParticipants = this._participantRepo.listByMeeting(this._meetingId)

    const inferred = await this._provider.inferContext({
      source: { spans },
      knownAgendaItems: existingAgenda.map((a) => ({ title: a.title, topic: a.topic })),
    })

    // Drop anything the repo already holds. The real engine already strips
    // covered agenda titles, but the runtime must not depend on the provider for
    // correctness — filter here too (idempotent) so a provider that echoes the
    // known agenda can never double it. Participants have no such engine step.
    const knownNames = new Set(existingParticipants.map((p) => p.name.trim().toLowerCase()))
    const contextToPersist = {
      agendaItems: inferred.agendaItems.filter((a) => !isTitleCovered(a.title, existingAgenda)),
      participants: inferred.participants.filter(
        (p) => !knownNames.has(p.name.trim().toLowerCase()),
      ),
    }

    // Persist the genuinely-new inferred agenda as Proposed + new participants
    // (the shared rule), reusing the created rows to enrich the context below.
    const { agendaItems: newAgenda, participants: newParticipants } = persistInferredContext(
      { agendaItemRepo: this._agendaItemRepo, participantRepo: this._participantRepo },
      this._meetingId,
      contextToPersist,
    )

    // Enrich the context with the full agenda (existing + newly inferred) so the
    // final pass routes decisions/actions onto the real items and nudges reflect them.
    this._contextOwner.enrich({
      agendaItems: [...existingAgenda, ...newAgenda],
      participants: [...existingParticipants, ...newParticipants],
    })

    // Replace an auto-generated placeholder title with the inferred one, then
    // clear the flag so it is never overwritten again. A user-set title (flag
    // false) is left untouched.
    if (
      meeting.titleAutoGenerated &&
      inferred.title !== undefined &&
      inferred.title.length > 0 &&
      this._meetingRepo !== undefined
    ) {
      this._meetingRepo.update({
        ...meeting,
        title: inferred.title,
        titleAutoGenerated: false,
      })
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Stop the runtime. After this, handleSpan() and tick() are no-ops. */
  stop(): void {
    this._stopped = true
  }
}
