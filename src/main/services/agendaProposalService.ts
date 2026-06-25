/**
 * AgendaProposalService (ADR 0029 — live agenda inference).
 *
 * Inserts agent-proposed Agenda Items as `proposed`, skipping near-duplicates of
 * existing items (Confirmed or Proposed) via a normalised-title compare shared
 * with the extraction adapters' grounding filter (`isTitleCovered`). It is
 * strictly append-only: it never edits or retracts items — its own rough guesses
 * linger until the note-taker acts or the final pass re-infers (ADR 0029,
 * rejected the reconciling-matcher option).
 */
import { randomUUID } from 'crypto'

import { isTitleCovered, normaliseAgendaTitle } from '@shared/agenda/agendaTitle'
import type { AgendaItem, MeetingId } from '@shared/domain'
import { OffAgenda } from '@shared/domain'

import type { agendaItemRepo } from '../db/repos/agendaItemRepo'

export interface AgendaProposalServiceDeps {
  agendaItemRepo: ReturnType<typeof agendaItemRepo>
}

export class AgendaProposalService {
  private readonly _agendaItemRepo: ReturnType<typeof agendaItemRepo>

  constructor(deps: AgendaProposalServiceDeps) {
    this._agendaItemRepo = deps.agendaItemRepo
  }

  /**
   * Propose new Agenda Items for `meetingId`. Topics whose normalised title is
   * already covered by an existing item (or the Off-agenda sentinel), or that
   * repeat within the same batch, are skipped. Returns only the items actually
   * inserted (all `proposed`).
   */
  propose(meetingId: MeetingId, topics: { title: string; topic: string }[]): AgendaItem[] {
    // Dedup target: existing items plus the Off-agenda sentinel, growing as we
    // accept items in this batch so in-batch duplicates are skipped too.
    const known: { title: string }[] = [OffAgenda, ...this._agendaItemRepo.listByMeeting(meetingId)]
    const inserted: AgendaItem[] = []

    for (const t of topics) {
      if (normaliseAgendaTitle(t.title).length === 0) continue
      if (isTitleCovered(t.title, known)) continue

      const item: AgendaItem = {
        id: randomUUID(),
        title: t.title,
        topic: t.topic,
        state: 'proposed',
      }
      this._agendaItemRepo.insert(item, meetingId)
      inserted.push(item)
      known.push(item)
    }

    return inserted
  }
}
