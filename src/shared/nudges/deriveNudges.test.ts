/**
 * Unit tests for deriveNudges (item 0019).
 *
 * Tests follow TDD red-green-refactor. Each nudge rule is tested for:
 *   - fire cases (heuristic met)
 *   - no-fire cases (heuristic not met)
 *   - deterministic IDs (same input → same ID)
 */

import { describe, expect, it } from 'vitest'

import type { Action, AgendaItem, Decision, Participant, TranscriptSpan } from '../domain/types'

import { deriveNudges } from './deriveNudges'
import type { DeriveNudgesState } from './deriveNudges'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const agendaItem1: AgendaItem = {
  id: 'ag1',
  title: 'Q3 Review',
  topic: 'Review Q3 results',
  state: 'confirmed',
}
const agendaItem2: AgendaItem = {
  id: 'ag2',
  title: 'Planning',
  topic: 'Next quarter plan',
  state: 'confirmed',
}

const participant1: Participant = { id: 'p1', name: 'Jeroen' }
const participant2: Participant = { id: 'p2', name: 'Anouk' }

const span1: TranscriptSpan = {
  id: 'span1',
  text: 'We bespreken de Q3 resultaten.',
  startMs: 0,
  endMs: 5000,
}

function makeDecision(overrides: Partial<Decision>): Decision {
  return {
    id: 'dec1',
    rationale: 'We have decided something',
    agendaItemId: 'ag1',
    sourceSpanId: 'span1',
    state: 'confirmed',
    ...overrides,
  }
}

function makeAction(overrides: Partial<Action>): Action {
  return {
    id: 'act1',
    agendaItemId: 'ag1',
    sourceSpanId: 'span1',
    status: 'open',
    state: 'confirmed',
    ...overrides,
  }
}

const baseState: DeriveNudgesState = {
  decisions: [],
  actions: [],
  agendaItems: [agendaItem1, agendaItem2],
  participants: [participant1, participant2],
  transcriptSpans: [span1],
  meetingStartedAt: new Date('2024-01-01T10:00:00Z'),
}

const nowAfter5Min = new Date('2024-01-01T10:06:00Z') // 6 minutes after start
const nowBefore5Min = new Date('2024-01-01T10:03:00Z') // 3 minutes after start

// ---------------------------------------------------------------------------
// Rule 1: OwnerMissing
// ---------------------------------------------------------------------------

describe('OwnerMissing nudge', () => {
  it('fires for a confirmed Action with no owner', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act1', state: 'confirmed', owner: undefined })],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'action-no-owner')).toBe(true)
  })

  it('does NOT fire for a proposed Action with no owner', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act1', state: 'proposed', owner: undefined })],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'action-no-owner')).toBe(false)
  })

  it('does NOT fire for a confirmed Action with an owner', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act1', state: 'confirmed', owner: 'p1' })],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'action-no-owner')).toBe(false)
  })

  it('nudge ID is deterministic: same input → same ID', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act-xyz', state: 'confirmed', owner: undefined })],
    }
    const nudges1 = deriveNudges(state, nowAfter5Min)
    const nudges2 = deriveNudges(state, nowAfter5Min)
    expect(nudges1[0]?.id).toBe(nudges2[0]?.id)
    expect(nudges1[0]?.id).toBe('action-no-owner:act-xyz')
  })

  it('nudge includes the action ID in relatedItemIds', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act-abc', state: 'confirmed', owner: undefined })],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    const nudge = nudges.find((n) => n.kind === 'action-no-owner')
    expect(nudge?.relatedItemIds).toContain('act-abc')
  })
})

// ---------------------------------------------------------------------------
// Rule 2: ConflictingDecisions
// ---------------------------------------------------------------------------

describe('ConflictingDecisions nudge', () => {
  /**
   * Heuristic: two confirmed decisions in the same agenda item whose rationales
   * share no content words (words ≥5 chars not in the stopword list).
   */
  it('fires for two confirmed decisions in the same agenda item with no shared content words', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [
        makeDecision({
          id: 'dec1',
          agendaItemId: 'ag1',
          rationale: 'Gebruik alleen React',
          state: 'confirmed',
        }),
        makeDecision({
          id: 'dec2',
          agendaItemId: 'ag1',
          rationale: 'Migreer volledig Python',
          state: 'confirmed',
        }),
      ],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'conflicting-decisions')).toBe(true)
  })

  it('does NOT fire for a single confirmed decision', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [
        makeDecision({
          id: 'dec1',
          agendaItemId: 'ag1',
          rationale: 'Gebruik alleen React',
          state: 'confirmed',
        }),
      ],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'conflicting-decisions')).toBe(false)
  })

  it('does NOT fire for two confirmed decisions in DIFFERENT agenda items', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [
        makeDecision({
          id: 'dec1',
          agendaItemId: 'ag1',
          rationale: 'Gebruik alleen React',
          state: 'confirmed',
        }),
        makeDecision({
          id: 'dec2',
          agendaItemId: 'ag2',
          rationale: 'Migreer volledig Python',
          state: 'confirmed',
        }),
      ],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'conflicting-decisions')).toBe(false)
  })

  it('does NOT fire for two confirmed decisions that share content words', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [
        makeDecision({
          id: 'dec1',
          agendaItemId: 'ag1',
          rationale: 'De frontend wordt gebouwd React-componenten',
          state: 'confirmed',
        }),
        makeDecision({
          id: 'dec2',
          agendaItemId: 'ag1',
          rationale: 'React-componenten vereisen TypeScript strikte types',
          state: 'confirmed',
        }),
      ],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'conflicting-decisions')).toBe(false)
  })

  it('does NOT fire for proposed decisions (only confirmed)', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [
        makeDecision({
          id: 'dec1',
          agendaItemId: 'ag1',
          rationale: 'Gebruik alleen React',
          state: 'proposed',
        }),
        makeDecision({
          id: 'dec2',
          agendaItemId: 'ag1',
          rationale: 'Migreer volledig Python',
          state: 'proposed',
        }),
      ],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'conflicting-decisions')).toBe(false)
  })

  it('nudge ID is deterministic: same input → same ID regardless of order', () => {
    const decA = makeDecision({
      id: 'dec-a',
      agendaItemId: 'ag1',
      rationale: 'Gebruik alleen React',
      state: 'confirmed',
    })
    const decB = makeDecision({
      id: 'dec-b',
      agendaItemId: 'ag1',
      rationale: 'Migreer volledig Python',
      state: 'confirmed',
    })
    const state1 = { ...baseState, decisions: [decA, decB] }
    const state2 = { ...baseState, decisions: [decB, decA] }
    const nudges1 = deriveNudges(state1, nowAfter5Min)
    const nudges2 = deriveNudges(state2, nowAfter5Min)
    const n1 = nudges1.find((n) => n.kind === 'conflicting-decisions')
    const n2 = nudges2.find((n) => n.kind === 'conflicting-decisions')
    expect(n1?.id).toBeDefined()
    expect(n1?.id).toBe(n2?.id)
  })
})

// ---------------------------------------------------------------------------
// Rule 3: EmptyAgendaItem
// ---------------------------------------------------------------------------

describe('EmptyAgendaItem nudge', () => {
  it('fires when meeting > 5 min old and an agenda item has no decisions or actions', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [],
      actions: [],
      agendaItems: [agendaItem1],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'empty-agenda-item')).toBe(true)
  })

  it('does NOT fire when meeting is less than 5 minutes old', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [],
      actions: [],
      agendaItems: [agendaItem1],
    }
    const nudges = deriveNudges(state, nowBefore5Min)
    expect(nudges.some((n) => n.kind === 'empty-agenda-item')).toBe(false)
  })

  it('does NOT fire when an agenda item has at least one decision', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [makeDecision({ id: 'dec1', agendaItemId: 'ag1', state: 'confirmed' })],
      actions: [],
      agendaItems: [agendaItem1],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'empty-agenda-item')).toBe(false)
  })

  it('does NOT fire when an agenda item has at least one action', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [],
      actions: [makeAction({ id: 'act1', agendaItemId: 'ag1', state: 'confirmed' })],
      agendaItems: [agendaItem1],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'empty-agenda-item')).toBe(false)
  })

  it('does NOT fire when there are no transcript spans (meeting not really started)', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [],
      actions: [],
      agendaItems: [agendaItem1],
      transcriptSpans: [],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges.some((n) => n.kind === 'empty-agenda-item')).toBe(false)
  })

  it('nudge ID is deterministic: same input → same ID', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [],
      actions: [],
      agendaItems: [{ id: 'ag-test', title: 'Test', topic: 'Test topic', state: 'confirmed' }],
    }
    const nudges1 = deriveNudges(state, nowAfter5Min)
    const nudges2 = deriveNudges(state, nowAfter5Min)
    const n1 = nudges1.find((n) => n.kind === 'empty-agenda-item')
    const n2 = nudges2.find((n) => n.kind === 'empty-agenda-item')
    expect(n1?.id).toBeDefined()
    expect(n1?.id).toBe(n2?.id)
    expect(n1?.id).toBe('empty-agenda-item:ag-test')
  })

  it('fires for each empty agenda item separately', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      decisions: [],
      actions: [],
      agendaItems: [agendaItem1, agendaItem2],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    const emptyNudges = nudges.filter((n) => n.kind === 'empty-agenda-item')
    expect(emptyNudges).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Nudge schema compliance
// ---------------------------------------------------------------------------

describe('nudge schema', () => {
  it('nudge message is an i18n key string', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act1', state: 'confirmed', owner: undefined })],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges[0]?.message).toBe('nudge.action-no-owner')
  })

  it('nudge has no dismissedAt by default', () => {
    const state: DeriveNudgesState = {
      ...baseState,
      actions: [makeAction({ id: 'act1', state: 'confirmed', owner: undefined })],
    }
    const nudges = deriveNudges(state, nowAfter5Min)
    expect(nudges[0]?.dismissedAt).toBeUndefined()
  })
})
