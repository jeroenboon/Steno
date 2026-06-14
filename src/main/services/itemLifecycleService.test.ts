/**
 * @vitest-environment node
 *
 * Tests for ItemLifecycleService (item 0007).
 *
 * Rules under test (directly from CONTEXT.md "Proposed / Confirmed"):
 *   - The Extraction Provider only ever creates items as Proposed (suggestions).
 *   - The note-taker confirms, dismisses, or edits-then-confirms.
 *   - The agent may revise or retract its own Proposed items as context arrives
 *     but NEVER silently alters a Confirmed item.
 *   - Manual create during Live → directly Confirmed.
 *
 * Tests use an in-memory SQLite DB with migrations applied. All assertions go
 * through the public service interface or the repos (never internal state).
 */

import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { MeetingId } from '@shared/domain'

import { runMigrations } from '../db/migrate'
import { actionRepo } from '../db/repos/actionRepo'
import { decisionRepo } from '../db/repos/decisionRepo'
import { meetingRepo } from '../db/repos/meetingRepo'
import { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import { ItemLifecycleService } from './itemLifecycleService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const MEETING_ID: MeetingId = 'meeting-001'
const SPAN_ID = 'span-001'
const AGENDA_ID = 'agenda-001'

function seedMeeting(db: Database.Database): void {
  meetingRepo(db).insert({
    id: MEETING_ID,
    title: 'Test meeting',
    state: 'live',
    paused: false,
    createdAt: '2026-06-14T10:00:00.000Z',
    primaryLanguage: 'nl',
  })

  // Seed the transcript span required by FK on decisions/actions.source_span_id
  transcriptSpanRepo(db).insert(
    { id: SPAN_ID, text: 'Test span', startMs: 0, endMs: 1000 },
    MEETING_ID,
  )
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Database.Database
let decRepo: ReturnType<typeof decisionRepo>
let actRepo: ReturnType<typeof actionRepo>
let svc: ItemLifecycleService

beforeEach(() => {
  db = openDb()
  decRepo = decisionRepo(db)
  actRepo = actionRepo(db)
  svc = new ItemLifecycleService(decRepo, actRepo)
  seedMeeting(db)
})

// ===========================================================================
// proposeItems — agent creates new Proposed items
// ===========================================================================

describe('proposeItems', () => {
  it('creates decisions in Proposed state', () => {
    const results = svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'We go forward', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })

    expect(results.decisions).toHaveLength(1)
    expect(results.decisions[0]?.state).toBe('proposed')
  })

  it('persists proposed decisions to the DB', () => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'We go forward', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })

    const persisted = decRepo.findById('d1')
    expect(persisted).not.toBeNull()
    expect(persisted?.state).toBe('proposed')
  })

  it('creates actions in Proposed state', () => {
    const results = svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })

    expect(results.actions).toHaveLength(1)
    expect(results.actions[0]?.state).toBe('proposed')
  })

  it('persists proposed actions to the DB', () => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })

    const persisted = actRepo.findById('a1')
    expect(persisted).not.toBeNull()
    expect(persisted?.state).toBe('proposed')
  })

  it('can propose a mix of decisions and actions in one call', () => {
    const results = svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'Go forward', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })

    expect(results.decisions).toHaveLength(1)
    expect(results.actions).toHaveLength(1)
  })
})

// ===========================================================================
// reviseProposed — agent updates its own still-Proposed decision
// ===========================================================================

describe('reviseProposed — decisions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'Original', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
  })

  it('updates the rationale of a Proposed decision', () => {
    const result = svc.reviseProposedDecision('d1', { rationale: 'Revised' })
    expect(result.rationale).toBe('Revised')
    expect(result.state).toBe('proposed')
  })

  it('persists the revision to the DB', () => {
    svc.reviseProposedDecision('d1', { rationale: 'Revised' })
    expect(decRepo.findById('d1')?.rationale).toBe('Revised')
  })

  it('THROWS if the decision is already Confirmed', () => {
    svc.confirm({ kind: 'decision', id: 'd1' })
    expect(() => svc.reviseProposedDecision('d1', { rationale: 'Too late' })).toThrow(/confirmed/i)
  })

  it('THROWS if the decision does not exist', () => {
    expect(() => svc.reviseProposedDecision('no-such', { rationale: 'X' })).toThrow(/not found/i)
  })
})

describe('reviseProposed — actions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
  })

  it('updates the owner of a Proposed action', () => {
    const result = svc.reviseProposedAction('a1', { owner: 'participant-42' })
    expect(result.owner).toBe('participant-42')
    expect(result.state).toBe('proposed')
  })

  it('persists the revision to the DB', () => {
    svc.reviseProposedAction('a1', { owner: 'participant-42' })
    expect(actRepo.findById('a1')?.owner).toBe('participant-42')
  })

  it('THROWS if the action is already Confirmed', () => {
    svc.confirm({ kind: 'action', id: 'a1' })
    expect(() => svc.reviseProposedAction('a1', { owner: 'p2' })).toThrow(/confirmed/i)
  })

  it('THROWS if the action does not exist', () => {
    expect(() => svc.reviseProposedAction('no-such', { owner: 'p2' })).toThrow(/not found/i)
  })
})

// ===========================================================================
// retractProposed — agent removes a still-Proposed item
// ===========================================================================

describe('retractProposed — decisions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'To retract', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
  })

  it('removes a Proposed decision from the DB', () => {
    svc.retractProposed({ kind: 'decision', id: 'd1' })
    expect(decRepo.findById('d1')).toBeNull()
  })

  it('THROWS if the decision is already Confirmed', () => {
    svc.confirm({ kind: 'decision', id: 'd1' })
    expect(() => {
      svc.retractProposed({ kind: 'decision', id: 'd1' })
    }).toThrow(/confirmed/i)
  })

  it('THROWS if the decision does not exist', () => {
    expect(() => {
      svc.retractProposed({ kind: 'decision', id: 'no-such' })
    }).toThrow(/not found/i)
  })
})

describe('retractProposed — actions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
  })

  it('removes a Proposed action from the DB', () => {
    svc.retractProposed({ kind: 'action', id: 'a1' })
    expect(actRepo.findById('a1')).toBeNull()
  })

  it('THROWS if the action is already Confirmed', () => {
    svc.confirm({ kind: 'action', id: 'a1' })
    expect(() => {
      svc.retractProposed({ kind: 'action', id: 'a1' })
    }).toThrow(/confirmed/i)
  })

  it('THROWS if the action does not exist', () => {
    expect(() => {
      svc.retractProposed({ kind: 'action', id: 'no-such' })
    }).toThrow(/not found/i)
  })
})

// ===========================================================================
// confirm — note-taker confirms a Proposed item → Confirmed
// ===========================================================================

describe('confirm — decisions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'To confirm', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
  })

  it('transitions a Proposed decision to Confirmed', () => {
    const result = svc.confirm({ kind: 'decision', id: 'd1' })
    expect(result.state).toBe('confirmed')
  })

  it('persists the Confirmed state to the DB', () => {
    svc.confirm({ kind: 'decision', id: 'd1' })
    expect(decRepo.findById('d1')?.state).toBe('confirmed')
  })

  it('THROWS if the decision does not exist', () => {
    expect(() => svc.confirm({ kind: 'decision', id: 'no-such' })).toThrow(/not found/i)
  })
})

describe('confirm — actions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
  })

  it('transitions a Proposed action to Confirmed', () => {
    const result = svc.confirm({ kind: 'action', id: 'a1' })
    expect(result.state).toBe('confirmed')
  })

  it('persists the Confirmed state to the DB', () => {
    svc.confirm({ kind: 'action', id: 'a1' })
    expect(actRepo.findById('a1')?.state).toBe('confirmed')
  })

  it('THROWS if the action does not exist', () => {
    expect(() => svc.confirm({ kind: 'action', id: 'no-such' })).toThrow(/not found/i)
  })
})

// ===========================================================================
// editAndConfirm — note-taker edits then confirms in one step
// ===========================================================================

describe('editAndConfirm — decisions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'Original', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
  })

  it('applies edits AND transitions to Confirmed', () => {
    const result = svc.editAndConfirmDecision('d1', { rationale: 'Edited and locked' })
    expect(result.rationale).toBe('Edited and locked')
    expect(result.state).toBe('confirmed')
  })

  it('persists both the edit and the Confirmed state', () => {
    svc.editAndConfirmDecision('d1', { rationale: 'Edited and locked' })
    const persisted = decRepo.findById('d1')
    expect(persisted?.rationale).toBe('Edited and locked')
    expect(persisted?.state).toBe('confirmed')
  })

  it('THROWS if the decision does not exist', () => {
    expect(() => svc.editAndConfirmDecision('no-such', { rationale: 'X' })).toThrow(/not found/i)
  })
})

describe('editAndConfirm — actions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
  })

  it('applies edits AND transitions to Confirmed', () => {
    const result = svc.editAndConfirmAction('a1', { owner: 'participant-1' })
    expect(result.owner).toBe('participant-1')
    expect(result.state).toBe('confirmed')
  })

  it('persists both the edit and the Confirmed state', () => {
    svc.editAndConfirmAction('a1', { owner: 'participant-1' })
    const persisted = actRepo.findById('a1')
    expect(persisted?.owner).toBe('participant-1')
    expect(persisted?.state).toBe('confirmed')
  })

  it('THROWS if the action does not exist', () => {
    expect(() => svc.editAndConfirmAction('no-such', { owner: 'p1' })).toThrow(/not found/i)
  })
})

// ===========================================================================
// dismiss — note-taker removes a Proposed item (never silently; must be Proposed)
// ===========================================================================

describe('dismiss — decisions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'To dismiss', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
  })

  it('removes a Proposed decision from the DB', () => {
    svc.dismiss({ kind: 'decision', id: 'd1' })
    expect(decRepo.findById('d1')).toBeNull()
  })

  it('THROWS if the decision is Confirmed — note-taker cannot dismiss a confirmed item this way', () => {
    svc.confirm({ kind: 'decision', id: 'd1' })
    expect(() => {
      svc.dismiss({ kind: 'decision', id: 'd1' })
    }).toThrow(/confirmed/i)
  })

  it('THROWS if the decision does not exist', () => {
    expect(() => {
      svc.dismiss({ kind: 'decision', id: 'no-such' })
    }).toThrow(/not found/i)
  })
})

describe('dismiss — actions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
  })

  it('removes a Proposed action from the DB', () => {
    svc.dismiss({ kind: 'action', id: 'a1' })
    expect(actRepo.findById('a1')).toBeNull()
  })

  it('THROWS if the action is Confirmed', () => {
    svc.confirm({ kind: 'action', id: 'a1' })
    expect(() => {
      svc.dismiss({ kind: 'action', id: 'a1' })
    }).toThrow(/confirmed/i)
  })

  it('THROWS if the action does not exist', () => {
    expect(() => {
      svc.dismiss({ kind: 'action', id: 'no-such' })
    }).toThrow(/not found/i)
  })
})

// ===========================================================================
// createConfirmed — manual add during Live → directly Confirmed
// ===========================================================================

describe('createConfirmed — decisions', () => {
  it('creates a decision already in Confirmed state', () => {
    const result = svc.createConfirmedDecision(MEETING_ID, {
      id: 'd-manual',
      rationale: 'Manual entry',
      agendaItemId: AGENDA_ID,
      sourceSpanId: SPAN_ID,
    })

    expect(result.state).toBe('confirmed')
  })

  it('persists the decision as Confirmed', () => {
    svc.createConfirmedDecision(MEETING_ID, {
      id: 'd-manual',
      rationale: 'Manual entry',
      agendaItemId: AGENDA_ID,
      sourceSpanId: SPAN_ID,
    })

    const persisted = decRepo.findById('d-manual')
    expect(persisted?.state).toBe('confirmed')
  })
})

describe('createConfirmed — actions', () => {
  it('creates an action already in Confirmed state', () => {
    const result = svc.createConfirmedAction(MEETING_ID, {
      id: 'a-manual',
      agendaItemId: AGENDA_ID,
      sourceSpanId: SPAN_ID,
      status: 'open',
      owner: 'participant-7',
    })

    expect(result.state).toBe('confirmed')
  })

  it('persists the action as Confirmed', () => {
    svc.createConfirmedAction(MEETING_ID, {
      id: 'a-manual',
      agendaItemId: AGENDA_ID,
      sourceSpanId: SPAN_ID,
      status: 'open',
      owner: 'participant-7',
    })

    const persisted = actRepo.findById('a-manual')
    expect(persisted?.state).toBe('confirmed')
  })
})

// ===========================================================================
// editConfirmed — explicit user edit of a Confirmed item (user action only)
// ===========================================================================

describe('editConfirmed — decisions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd1', rationale: 'Original', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
    svc.confirm({ kind: 'decision', id: 'd1' })
  })

  it('updates the rationale of a Confirmed decision', () => {
    const result = svc.editConfirmedDecision('d1', { rationale: 'Updated by user' })
    expect(result.rationale).toBe('Updated by user')
    expect(result.state).toBe('confirmed')
  })

  it('persists the edit', () => {
    svc.editConfirmedDecision('d1', { rationale: 'Updated by user' })
    expect(decRepo.findById('d1')?.rationale).toBe('Updated by user')
  })

  it('THROWS if the decision is not Confirmed', () => {
    svc.proposeItems(MEETING_ID, {
      decisions: [
        { id: 'd2', rationale: 'Still proposed', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID },
      ],
      actions: [],
    })
    expect(() => svc.editConfirmedDecision('d2', { rationale: 'X' })).toThrow(/proposed/i)
  })

  it('THROWS if the decision does not exist', () => {
    expect(() => svc.editConfirmedDecision('no-such', { rationale: 'X' })).toThrow(/not found/i)
  })
})

describe('editConfirmed — actions', () => {
  beforeEach(() => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a1', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
    svc.confirm({ kind: 'action', id: 'a1' })
  })

  it('updates the owner of a Confirmed action', () => {
    const result = svc.editConfirmedAction('a1', { owner: 'participant-99' })
    expect(result.owner).toBe('participant-99')
    expect(result.state).toBe('confirmed')
  })

  it('persists the edit', () => {
    svc.editConfirmedAction('a1', { owner: 'participant-99' })
    expect(actRepo.findById('a1')?.owner).toBe('participant-99')
  })

  it('THROWS if the action is not Confirmed', () => {
    svc.proposeItems(MEETING_ID, {
      decisions: [],
      actions: [{ id: 'a2', agendaItemId: AGENDA_ID, sourceSpanId: SPAN_ID, status: 'open' }],
    })
    expect(() => svc.editConfirmedAction('a2', { owner: 'p1' })).toThrow(/proposed/i)
  })

  it('THROWS if the action does not exist', () => {
    expect(() => svc.editConfirmedAction('no-such', { owner: 'p1' })).toThrow(/not found/i)
  })
})
