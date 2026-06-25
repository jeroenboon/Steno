/**
 * AgendaInferenceScheduler (ADR 0029 — live agenda inference).
 *
 * A slow-cadence counterpart to ExtractionLoopScheduler. On each `tick()` past
 * the cadence boundary it infers agenda topics over the whole transcript so far,
 * grounded by the current agenda (Confirmed + Proposed) so the provider returns
 * only uncovered topics, and feeds them to the AgendaProposalService. The
 * proposal step is append-only and deduped — the scheduler never revises or
 * retracts its own proposals.
 *
 * The cadence is deliberately slow (default 90 s): live agenda inference is a
 * background aid, not the latency-sensitive Decisions/Actions loop.
 *
 * Determinism: time comes only from the injected Clock; tests advance it
 * explicitly. Never logs transcript content (principle #12).
 */
import type { MeetingId } from '@shared/domain'
import type { Clock, ExtractionProvider } from '@shared/providers'

import type { agendaItemRepo } from '../db/repos/agendaItemRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import type { AgendaProposalService } from './agendaProposalService'

/** Default slow cadence: 90 s between agenda inference ticks. */
const DEFAULT_AGENDA_CADENCE_MS = 90_000

export interface AgendaInferenceSchedulerDeps {
  provider: ExtractionProvider
  proposalService: AgendaProposalService
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  agendaItemRepo: ReturnType<typeof agendaItemRepo>
  clock: Clock
  /** Milliseconds between agenda inference ticks. Defaults to 90 000 ms. */
  cadenceMs?: number
}

export class AgendaInferenceScheduler {
  private readonly _provider: ExtractionProvider
  private readonly _proposalService: AgendaProposalService
  private readonly _spanRepo: ReturnType<typeof transcriptSpanRepo>
  private readonly _agendaItemRepo: ReturnType<typeof agendaItemRepo>
  private readonly _clock: Clock
  private readonly _cadenceMs: number

  private _lastTickAt: number
  private _inFlight = false
  private _paused = false

  constructor(deps: AgendaInferenceSchedulerDeps) {
    this._provider = deps.provider
    this._proposalService = deps.proposalService
    this._spanRepo = deps.spanRepo
    this._agendaItemRepo = deps.agendaItemRepo
    this._clock = deps.clock
    this._cadenceMs = deps.cadenceMs ?? DEFAULT_AGENDA_CADENCE_MS
    this._lastTickAt = this._clock.now()
  }

  /** Halt ticks (pause halts the cadence, mirroring the extraction loop). */
  pause(): void {
    this._paused = true
  }

  /** Resume ticks. The cadence boundary is measured from the next tick. */
  resume(): void {
    this._paused = false
    this._lastTickAt = this._clock.now()
  }

  /**
   * Run one agenda-inference turn if the cadence boundary has been crossed.
   * No-op while paused, in flight, before the boundary, when the provider
   * cannot infer, or when there is no transcript yet.
   */
  async tick(meetingId: MeetingId): Promise<void> {
    if (this._paused || this._inFlight) return
    if (this._clock.now() - this._lastTickAt < this._cadenceMs) return
    if (this._provider.inferContext === undefined) return

    const spans = this._spanRepo.listByMeeting(meetingId)
    if (spans.length === 0) return

    this._inFlight = true
    try {
      const knownAgendaItems = this._agendaItemRepo
        .listByMeeting(meetingId)
        .map((a) => ({ title: a.title, topic: a.topic }))

      const inferred = await this._provider.inferContext({
        source: { spans },
        knownAgendaItems,
      })

      this._proposalService.propose(meetingId, inferred.agendaItems)
    } catch (err) {
      // Never log transcript content (principle #12) — only a non-sensitive tag.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[AgendaInferenceScheduler] inference tick failed: ${message}`)
    } finally {
      this._inFlight = false
      this._lastTickAt = this._clock.now()
    }
  }
}
