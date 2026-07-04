/**
 * persistInferredContext — the single implementation of the "inferred
 * agenda/participants are Proposed" rule (ADR 0029).
 *
 * When an extraction provider infers the agenda + participants from a transcript
 * (a live meeting the note-taker never prepared, or a file import with
 * inference on), the inferred agenda items are persisted as **Proposed** — the
 * user never confirmed them — while inferred participants are persisted as-is.
 * This rule previously lived twice: in `liveExtractionRuntime._inferContextOnEnd`
 * and in `ImportSessionController._inferAndPersistContext` (review item 5).
 *
 * The created rows are returned so a caller that also seeds an in-memory context
 * (the live runtime) can reuse them without a second query.
 */

import { randomUUID } from 'node:crypto'

import type { AgendaItem, Participant } from '@shared/domain'

import type { agendaItemRepo } from '../db/repos/agendaItemRepo'
import type { participantRepo } from '../db/repos/participantRepo'

export interface InferredContextInput {
  agendaItems: { title: string; topic: string }[]
  participants: { name: string }[]
}

export interface PersistInferredContextDeps {
  agendaItemRepo: ReturnType<typeof agendaItemRepo>
  participantRepo: ReturnType<typeof participantRepo>
}

export function persistInferredContext(
  deps: PersistInferredContextDeps,
  meetingId: string,
  inferred: InferredContextInput,
): { agendaItems: AgendaItem[]; participants: Participant[] } {
  const agendaItems: AgendaItem[] = inferred.agendaItems.map((a) => ({
    id: randomUUID(),
    title: a.title,
    topic: a.topic,
    state: 'proposed',
  }))
  for (const item of agendaItems) {
    deps.agendaItemRepo.insert(item, meetingId)
  }

  const participants: Participant[] = inferred.participants.map((p) => ({
    id: randomUUID(),
    name: p.name,
  }))
  for (const p of participants) {
    deps.participantRepo.insert(p, meetingId)
  }

  return { agendaItems, participants }
}
