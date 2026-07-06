/**
 * ExtractionSession — the shared extraction core both session controllers compose
 * (audit A3; closes the 2026-07 architecture review's item 5 remainder).
 *
 * `LiveExtractionRuntime` used to own the whole extraction lifecycle AND serve as
 * the import path's final-pass engine, so the import controller built the entire
 * ~560-line live runtime just to run one final pass, dead-coding around the
 * live-only guards. This core carves out the part both paths genuinely share:
 *
 *   - the `ExtractionLoopScheduler` (rolling turns + the final pass) and the
 *     `ItemLifecycleService` whose `onItemsChanged` seam pushes the authoritative
 *     item set (ADR 0033);
 *   - the emit-plumbing: `items:changed` (via `sendItemsChanged`), `items:summaries`
 *     after the final pass, and `nudges:changed` after every item mutation and the
 *     final pass.
 *
 * What stays OUT of the core (live-only, kept in LiveExtractionRuntime): span
 * ingestion/filtering, the `MeetingContextOwner` (routing + enrich), the slow
 * agenda-inference scheduler, the running summary, ASR-terminal forwarding,
 * pause/resume, and the live end-of-meeting inference. Import composes this core
 * directly and does its own (different) inference.
 *
 * ## Context is read through a getter, not owned
 *
 * Nudges and the final pass need the current agenda/participants. Live owns those
 * in a `MeetingContextOwner` that is enriched during end-of-meeting inference;
 * import holds a static snapshot. Rather than own either, the core takes a
 * `getContext()` callback so it always reads the caller's current context at emit
 * time — the live layer passes `() => contextOwner.current()`, import passes a
 * closure over its static context.
 *
 * ## agenda:changed is gated on `agendaItemRepo`
 *
 * On meeting end the live path pushes the authoritative agenda so Review can group
 * the routed final items; import does not (it leans on `meeting:load` in Review).
 * The emit is therefore gated on an optional `agendaItemRepo` — present for live,
 * absent for import. This is a genuine per-path difference, so the optionality
 * lives here, not in the (now live-only) runtime.
 */

import type { Meeting, MeetingId, TranscriptSpan } from '@shared/domain'
import type { AgendaChangedPayload, ItemsSummariesPayload, NudgesChangedPayload } from '@shared/ipc'
import { deriveNudges } from '@shared/nudges/deriveNudges'
import type { Clock, ExtractionProvider } from '@shared/providers'

import type { IpcSender } from '../audio/AudioCaptureBridge'
import type { actionRepo } from '../db/repos/actionRepo'
import type { agendaItemRepo } from '../db/repos/agendaItemRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'
import type { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import { ExtractionLoopScheduler, type MeetingContext } from './extractionLoopScheduler'
import { ItemLifecycleService } from './itemLifecycleService'
import { sendItemsChanged } from './itemsChangedNotifier'

export interface ExtractionSessionDeps {
  meetingId: MeetingId
  sender: IpcSender
  provider: ExtractionProvider
  clock: Clock
  /** Rolling cadence (ms). Defaults to the scheduler's own default. */
  cadenceMs?: number
  decisionsRepo: ReturnType<typeof decisionRepo>
  actionsRepo: ReturnType<typeof actionRepo>
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  dsRepo: ReturnType<typeof discussionSummaryRepo>
  /**
   * Read the current agenda/participants at emit time (nudges + not owned here).
   * Live passes `() => contextOwner.current()`; import passes its static context.
   */
  getContext: () => MeetingContext
  /**
   * When present, the end-of-meeting `agenda:changed` push reads the full agenda
   * from it (live). Absent for import, which leans on `meeting:load` in Review.
   */
  agendaItemRepo?: ReturnType<typeof agendaItemRepo>
  /** Meeting start, for the EmptyAgendaItem nudge heuristic. Defaults to now. */
  meetingStartedAt?: Date
}

export class ExtractionSession {
  private readonly _meetingId: MeetingId
  private readonly _sender: IpcSender
  private readonly _decisionsRepo: ReturnType<typeof decisionRepo>
  private readonly _actionsRepo: ReturnType<typeof actionRepo>
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _dsRepo: ReturnType<typeof discussionSummaryRepo>
  private readonly _agendaItemRepo: ReturnType<typeof agendaItemRepo> | undefined
  private readonly _getContext: () => MeetingContext
  private readonly _meetingStartedAt: Date
  private readonly _scheduler: ExtractionLoopScheduler

  constructor(deps: ExtractionSessionDeps) {
    this._meetingId = deps.meetingId
    this._sender = deps.sender
    this._decisionsRepo = deps.decisionsRepo
    this._actionsRepo = deps.actionsRepo
    this._spanRepo = deps.spanRepo
    this._dsRepo = deps.dsRepo
    this._agendaItemRepo = deps.agendaItemRepo
    this._getContext = deps.getContext
    this._meetingStartedAt = deps.meetingStartedAt ?? new Date()

    // The item lifecycle service's onItemsChanged seam pushes the authoritative
    // full item set (ADR 0033) and re-derives nudges. The scheduler and the IPC
    // push share this one service instance.
    const itemService = new ItemLifecycleService(
      deps.decisionsRepo,
      deps.actionsRepo,
      (meetingId) => {
        sendItemsChanged(this._sender, meetingId, deps.decisionsRepo, deps.actionsRepo)
        this._emitNudges()
      },
    )
    this._scheduler = new ExtractionLoopScheduler({
      provider: deps.provider,
      itemLifecycleService: itemService,
      discussionSummaryRepo: deps.dsRepo,
      spanRepo: deps.spanRepo,
      clock: deps.clock,
      ...(deps.cadenceMs !== undefined ? { cadenceMs: deps.cadenceMs } : {}),
    })
  }

  /** Register + persist a final span for the next rolling turn (autosave, #13). */
  addSpan(span: TranscriptSpan, meetingId: MeetingId): void {
    this._scheduler.addSpan(span, meetingId)
  }

  /** Run one rolling extraction turn if the cadence boundary has been crossed. */
  async tick(context: MeetingContext): Promise<void> {
    await this._scheduler.tick(this._meetingId, context)
  }

  /**
   * Run the final extraction pass over the given context snapshot, then emit the
   * end-of-meeting events: `agenda:changed` (live only, gated), `items:summaries`,
   * and `nudges:changed`. The scheduler's own guard prevents a double final pass.
   */
  async runFinalPass(meeting: Meeting, context: MeetingContext): Promise<void> {
    await this._scheduler.runFinalPass(meeting, context)

    // Push the authoritative agenda so Review can group the routed final items.
    // Live wires an agendaItemRepo; import does not (it leans on meeting:load).
    if (this._agendaItemRepo !== undefined) {
      this._sender.send('agenda:changed', {
        agendaItems: this._agendaItemRepo.listByMeeting(this._meetingId),
      } satisfies AgendaChangedPayload)
    }

    const summaries = this._dsRepo.listByMeeting(this._meetingId)
    this._sender.send('items:summaries', { summaries } satisfies ItemsSummariesPayload)

    this._emitNudges()
  }

  /**
   * Derive nudges from the current meeting state and emit 'nudges:changed'.
   * Called after every item mutation (via the onItemsChanged seam) and after the
   * final pass. Reads the caller's current context through the injected getter.
   */
  private _emitNudges(): void {
    const decisions = this._decisionsRepo.listByMeeting(this._meetingId)
    const actions = this._actionsRepo.listByMeeting(this._meetingId)
    const spans = this._spanRepo.listByMeeting(this._meetingId)
    const context = this._getContext()
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
}
