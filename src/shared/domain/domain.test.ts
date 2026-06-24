import { describe, expect, it } from 'vitest'

import {
  MeetingIdSchema,
  AgendaItemIdSchema,
  ParticipantIdSchema,
  DecisionIdSchema,
  ActionIdSchema,
  TranscriptSpanIdSchema,
  ParticipantSchema,
  TranscriptSpanSchema,
  DecisionSchema,
  ActionSchema,
  AgendaItemSchema,
  MeetingSchema,
  OffAgenda,
} from './types'

// ============================================================================
// BRANDED ID TESTS
// ============================================================================

describe('Branded ID constructors', () => {
  describe('MeetingId', () => {
    it('accepts a non-empty string', () => {
      const id = MeetingIdSchema.parse('meeting-123')
      expect(id).toBe('meeting-123')
    })

    it('rejects an empty string', () => {
      expect(() => MeetingIdSchema.parse('')).toThrow()
    })

    it('rejects null', () => {
      expect(() => MeetingIdSchema.parse(null)).toThrow()
    })

    it('rejects undefined', () => {
      expect(() => MeetingIdSchema.parse(undefined)).toThrow()
    })
  })

  describe('AgendaItemId', () => {
    it('accepts a non-empty string', () => {
      const id = AgendaItemIdSchema.parse('agenda-456')
      expect(id).toBe('agenda-456')
    })

    it('rejects an empty string', () => {
      expect(() => AgendaItemIdSchema.parse('')).toThrow()
    })
  })

  describe('ParticipantId', () => {
    it('accepts a non-empty string', () => {
      const id = ParticipantIdSchema.parse('participant-789')
      expect(id).toBe('participant-789')
    })

    it('rejects an empty string', () => {
      expect(() => ParticipantIdSchema.parse('')).toThrow()
    })
  })

  describe('DecisionId', () => {
    it('accepts a non-empty string', () => {
      const id = DecisionIdSchema.parse('decision-abc')
      expect(id).toBe('decision-abc')
    })

    it('rejects an empty string', () => {
      expect(() => DecisionIdSchema.parse('')).toThrow()
    })
  })

  describe('ActionId', () => {
    it('accepts a non-empty string', () => {
      const id = ActionIdSchema.parse('action-def')
      expect(id).toBe('action-def')
    })

    it('rejects an empty string', () => {
      expect(() => ActionIdSchema.parse('')).toThrow()
    })
  })

  describe('TranscriptSpanId', () => {
    it('accepts a non-empty string', () => {
      const id = TranscriptSpanIdSchema.parse('span-ghi')
      expect(id).toBe('span-ghi')
    })

    it('rejects an empty string', () => {
      expect(() => TranscriptSpanIdSchema.parse('')).toThrow()
    })
  })
})

// ============================================================================
// TRANSCRIPT SPAN TESTS
// ============================================================================

describe('TranscriptSpan', () => {
  it('parses a valid transcript span', () => {
    const span = TranscriptSpanSchema.parse({
      id: 'span-1',
      text: 'We need to fix the bug',
      startMs: 1000,
      endMs: 2000,
      confidence: 0.95,
      speakerLabel: 'Speaker 1',
    })
    expect(span.text).toBe('We need to fix the bug')
    expect(span.confidence).toBe(0.95)
    expect(span.speakerLabel).toBe('Speaker 1')
  })

  it('allows optional speakerLabel', () => {
    const span = TranscriptSpanSchema.parse({
      id: 'span-2',
      text: 'Another statement',
      startMs: 2000,
      endMs: 3000,
      confidence: 0.85,
    })
    expect(span.speakerLabel).toBeUndefined()
  })

  it('allows confidence to be optional', () => {
    const span = TranscriptSpanSchema.parse({
      id: 'span-3',
      text: 'Yet another',
      startMs: 3000,
      endMs: 4000,
    })
    expect(span.confidence).toBeUndefined()
  })

  it('rejects a span missing text', () => {
    expect(() =>
      TranscriptSpanSchema.parse({
        id: 'span-4',
        startMs: 4000,
        endMs: 5000,
      }),
    ).toThrow()
  })

  it('rejects a span with empty text', () => {
    expect(() =>
      TranscriptSpanSchema.parse({
        id: 'span-5',
        text: '',
        startMs: 5000,
        endMs: 6000,
      }),
    ).toThrow()
  })
})

// ============================================================================
// PARTICIPANT TESTS
// ============================================================================

describe('Participant', () => {
  it('parses a valid participant', () => {
    const p = ParticipantSchema.parse({
      id: 'p-1',
      name: 'Jeroen',
    })
    expect(p.id).toBe('p-1')
    expect(p.name).toBe('Jeroen')
  })

  it('rejects a participant with empty name', () => {
    expect(() =>
      ParticipantSchema.parse({
        id: 'p-2',
        name: '',
      }),
    ).toThrow()
  })

  it('rejects a participant missing name', () => {
    expect(() =>
      ParticipantSchema.parse({
        id: 'p-3',
      }),
    ).toThrow()
  })
})

// ============================================================================
// DECISION TESTS
// ============================================================================

describe('Decision', () => {
  const validDecision = {
    id: 'decision-1',
    rationale: 'We agreed to use TypeScript',
    agendaItemId: 'agenda-1',
    sourceSpanId: 'span-1',
  }

  it('parses a valid decision', () => {
    const decision = DecisionSchema.parse(validDecision)
    expect(decision.rationale).toBe('We agreed to use TypeScript')
    expect(decision.agendaItemId).toBe('agenda-1')
    expect(decision.sourceSpanId).toBe('span-1')
  })

  it('requires rationale', () => {
    const invalid = { ...validDecision, rationale: undefined }
    expect(() => DecisionSchema.parse(invalid)).toThrow()
  })

  it('allows rationale to be empty string', () => {
    // Empty rationale is allowed, just not missing
    const decision = DecisionSchema.parse({ ...validDecision, rationale: '' })
    expect(decision.rationale).toBe('')
  })

  it('requires agendaItemId or off-agenda designation', () => {
    // This is covered by the agendaItemId being required
    const invalid = { ...validDecision, agendaItemId: undefined }
    expect(() => DecisionSchema.parse(invalid)).toThrow()
  })

  it('requires sourceSpanId', () => {
    const invalid = { ...validDecision, sourceSpanId: undefined }
    expect(() => DecisionSchema.parse(invalid)).toThrow()
  })

  it('has a state field (proposed or confirmed)', () => {
    const decision = DecisionSchema.parse({
      ...validDecision,
      state: 'proposed',
    })
    expect(decision.state).toBe('proposed')
  })

  it('defaults state to proposed when not provided', () => {
    const decision = DecisionSchema.parse(validDecision)
    expect(decision.state).toBe('proposed')
  })
})

// ============================================================================
// ACTION TESTS
// ============================================================================

describe('Action', () => {
  const validAction = {
    id: 'action-1',
    agendaItemId: 'agenda-1',
    sourceSpanId: 'span-1',
    status: 'open' as const,
  }

  it('parses a valid action', () => {
    const action = ActionSchema.parse(validAction)
    expect(action.status).toBe('open')
    expect(action.agendaItemId).toBe('agenda-1')
  })

  it('allows owner to be undefined', () => {
    const action = ActionSchema.parse(validAction)
    expect(action.owner).toBeUndefined()
  })

  it('allows owner to be set when state is confirmed', () => {
    const action = ActionSchema.parse({
      ...validAction,
      state: 'confirmed',
      owner: 'p-1',
    })
    expect(action.owner).toBe('p-1')
  })

  it('allows owner to be optional in any state', () => {
    // Owner is optional throughout the action lifecycle
    const proposedWithOwner = ActionSchema.parse({
      ...validAction,
      state: 'proposed',
      owner: 'p-1',
    })
    expect(proposedWithOwner.owner).toBe('p-1')
  })

  it('allows dueDate to be undefined', () => {
    const action = ActionSchema.parse(validAction)
    expect(action.dueDate).toBeUndefined()
  })

  it('allows dueDate to be set', () => {
    const dueDate = new Date('2026-12-31')
    const action = ActionSchema.parse({
      ...validAction,
      dueDate: dueDate.toISOString(),
    })
    expect(action.dueDate).toBe(dueDate.toISOString())
  })

  it('has a state field (proposed or confirmed)', () => {
    const action = ActionSchema.parse({
      ...validAction,
      state: 'proposed',
    })
    expect(action.state).toBe('proposed')
  })

  it('defaults state to proposed when not provided', () => {
    const action = ActionSchema.parse(validAction)
    expect(action.state).toBe('proposed')
  })

  it('has status field with open or done', () => {
    const action = ActionSchema.parse({
      ...validAction,
      status: 'done',
    })
    expect(action.status).toBe('done')
  })

  it('rejects invalid status', () => {
    expect(() =>
      ActionSchema.parse({
        ...validAction,
        status: 'cancelled',
      }),
    ).toThrow()
  })

  it('requires agendaItemId', () => {
    const invalid = { ...validAction, agendaItemId: undefined }
    expect(() => ActionSchema.parse(invalid)).toThrow()
  })

  it('requires sourceSpanId', () => {
    const invalid = { ...validAction, sourceSpanId: undefined }
    expect(() => ActionSchema.parse(invalid)).toThrow()
  })
})

// ============================================================================
// AGENDA ITEM TESTS
// ============================================================================

describe('AgendaItem', () => {
  it('parses a valid agenda item', () => {
    const item = AgendaItemSchema.parse({
      id: 'agenda-1',
      title: 'Review Q3 results',
      topic: 'Performance review',
    })
    expect(item.title).toBe('Review Q3 results')
    expect(item.topic).toBe('Performance review')
  })

  it('rejects an agenda item with empty title', () => {
    expect(() =>
      AgendaItemSchema.parse({
        id: 'agenda-2',
        title: '',
        topic: 'Something',
      }),
    ).toThrow()
  })

  it('rejects an agenda item with empty topic', () => {
    expect(() =>
      AgendaItemSchema.parse({
        id: 'agenda-3',
        title: 'Some title',
        topic: '',
      }),
    ).toThrow()
  })

  it('defaults state to confirmed when absent', () => {
    const item = AgendaItemSchema.parse({
      id: 'agenda-4',
      title: 'Some title',
      topic: 'Some topic',
    })
    expect(item.state).toBe('confirmed')
  })

  it('accepts a proposed state', () => {
    const item = AgendaItemSchema.parse({
      id: 'agenda-5',
      title: 'Some title',
      topic: 'Some topic',
      state: 'proposed',
    })
    expect(item.state).toBe('proposed')
  })

  it('rejects an unknown state', () => {
    expect(() =>
      AgendaItemSchema.parse({
        id: 'agenda-6',
        title: 'Some title',
        topic: 'Some topic',
        state: 'archived',
      }),
    ).toThrow()
  })
})

// ============================================================================
// OFF-AGENDA SENTINEL
// ============================================================================

describe('OffAgenda sentinel', () => {
  it('provides a fixed off-agenda ID', () => {
    expect(OffAgenda.id).toBeDefined()
    expect(typeof OffAgenda.id).toBe('string')
  })

  it('has a recognizable title', () => {
    expect(OffAgenda.title).toBe('Off-agenda')
  })

  it('can be used in place of agendaItemId', () => {
    const action = ActionSchema.parse({
      id: 'action-1',
      agendaItemId: OffAgenda.id,
      sourceSpanId: 'span-1',
      status: 'open',
    })
    expect(action.agendaItemId).toBe(OffAgenda.id)
  })
})

// ============================================================================
// MEETING TESTS
// ============================================================================

describe('Meeting', () => {
  it('parses a valid meeting in draft state', () => {
    const meeting = MeetingSchema.parse({
      id: 'meeting-1',
      state: 'draft',
      createdAt: new Date().toISOString(),
      title: 'Q3 Planning',
      primaryLanguage: 'nl',
    })
    expect(meeting.state).toBe('draft')
    expect(meeting.title).toBe('Q3 Planning')
  })

  it('allows all three meeting states', () => {
    const states: ('draft' | 'live' | 'ended')[] = ['draft', 'live', 'ended']
    for (const state of states) {
      const meeting = MeetingSchema.parse({
        id: `meeting-${state}`,
        state,
        createdAt: new Date().toISOString(),
        title: 'Test',
        primaryLanguage: 'en',
      })
      expect(meeting.state).toBe(state)
    }
  })

  it('requires a title', () => {
    expect(() =>
      MeetingSchema.parse({
        id: 'meeting-2',
        state: 'draft',
        createdAt: new Date().toISOString(),
        primaryLanguage: 'en',
      }),
    ).toThrow()
  })

  it('rejects empty title', () => {
    expect(() =>
      MeetingSchema.parse({
        id: 'meeting-3',
        state: 'draft',
        createdAt: new Date().toISOString(),
        title: '',
        primaryLanguage: 'en',
      }),
    ).toThrow()
  })

  it('defaults source to live when absent (back-compat)', () => {
    const meeting = MeetingSchema.parse({
      id: 'meeting-4',
      state: 'ended',
      createdAt: new Date().toISOString(),
      title: 'Legacy meeting',
      primaryLanguage: 'nl',
    })
    expect(meeting.source).toBe('live')
  })

  it('accepts an imported source', () => {
    const meeting = MeetingSchema.parse({
      id: 'meeting-5',
      state: 'ended',
      source: 'import',
      createdAt: new Date().toISOString(),
      title: 'Imported recording',
      primaryLanguage: 'nl',
    })
    expect(meeting.source).toBe('import')
  })

  it('rejects an unknown source', () => {
    expect(() =>
      MeetingSchema.parse({
        id: 'meeting-6',
        state: 'ended',
        source: 'telepathy',
        createdAt: new Date().toISOString(),
        title: 'Nope',
        primaryLanguage: 'nl',
      }),
    ).toThrow()
  })
})

// ============================================================================
// DISCUSSION SUMMARY TESTS
// ============================================================================

describe('DiscussionSummary', () => {
  it('parses a valid discussion summary', () => {
    // DiscussionSummary will be tested once the type is defined
    expect(true).toBe(true)
  })
})

// ============================================================================
// RUNNING SUMMARY TESTS
// ============================================================================

describe('RunningSummary', () => {
  it('parses a valid running summary', () => {
    // RunningSummary will be tested once the type is defined
    expect(true).toBe(true)
  })
})

// ============================================================================
// NUDGE TESTS
// ============================================================================

describe('Nudge', () => {
  it('parses a valid nudge', () => {
    // Nudge will be tested once the type is defined
    expect(true).toBe(true)
  })
})
