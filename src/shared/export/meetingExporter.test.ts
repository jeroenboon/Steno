/**
 * Tests for the meeting export serializers (item 0022).
 *
 * Covers:
 *   - toMarkdown: Markdown structure, agenda ordering, off-agenda placement,
 *     owner resolution, due date formatting, empty meeting edge case
 *   - toJson: valid JSON, Zod schema validation
 */

import { describe, it, expect } from 'vitest'

import type { AgendaItem, Participant, Decision, Action, DiscussionSummary } from '../domain/types'
import { OffAgenda } from '../domain/types'

import { toMarkdown, toJson, ExportedMeetingSchema } from './meetingExporter'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE: Participant = { id: 'p-alice', name: 'Alice' }
const BOB: Participant = { id: 'p-bob', name: 'Bob' }

const AGENDA_Q3: AgendaItem = { id: 'ai-q3', title: 'Q3 Planning', topic: 'Budget review' }
const AGENDA_RETRO: AgendaItem = { id: 'ai-retro', title: 'Retrospectief', topic: 'Team feedback' }

const DECISION_A: Decision = {
  id: 'd-a',
  rationale: 'We gaan door met optie A.',
  agendaItemId: 'ai-q3',
  sourceSpanId: 'span-1',
  state: 'confirmed',
}

const DECISION_OFF: Decision = {
  id: 'd-off',
  rationale: 'Onverwachte beslissing.',
  agendaItemId: OffAgenda.id,
  sourceSpanId: 'span-2',
  state: 'confirmed',
}

const ACTION_BOB: Action = {
  id: 'a-bob',
  description: 'API-keys regelen',
  agendaItemId: 'ai-q3',
  sourceSpanId: 'span-3',
  owner: 'p-bob',
  dueDate: '2026-07-01T00:00:00.000Z',
  status: 'open',
  state: 'confirmed',
}

const ACTION_NO_OWNER: Action = {
  id: 'a-noowner',
  agendaItemId: 'ai-retro',
  sourceSpanId: 'span-4',
  status: 'open',
  state: 'confirmed',
}

const SUMMARY_Q3: DiscussionSummary = {
  id: 'sum-q3',
  agendaItemId: 'ai-q3',
  text: 'Het team heeft de budgetopties besproken.',
}

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------

describe('toMarkdown', () => {
  it('starts with the meeting title as h1', () => {
    const md = toMarkdown({
      title: 'Q3 Planning',
      agendaItems: [],
      participants: [],
      decisions: [],
      actions: [],
      summaries: [],
    })
    expect(md).toMatch(/^# Q3 Planning/)
  })

  it('renders agenda items as h2 sections', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [],
      decisions: [DECISION_A],
      actions: [],
      summaries: [],
    })
    expect(md).toContain('## Q3 Planning')
  })

  it('includes decision rationale as a list item', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [],
      decisions: [DECISION_A],
      actions: [],
      summaries: [],
    })
    expect(md).toContain('- We gaan door met optie A.')
  })

  it('renders the action description as the line text', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [BOB],
      decisions: [],
      actions: [ACTION_BOB],
      summaries: [],
    })
    expect(md).toContain('- API-keys regelen')
  })

  it('resolves action owner name from participants', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [ALICE, BOB],
      decisions: [],
      actions: [ACTION_BOB],
      summaries: [],
    })
    expect(md).toContain('Bob')
  })

  it('formats action due date as date only (no time)', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [BOB],
      decisions: [],
      actions: [ACTION_BOB],
      summaries: [],
    })
    expect(md).toContain('2026-07-01')
    expect(md).not.toContain('T00:00:00')
  })

  it('renders action without owner gracefully', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_RETRO],
      participants: [],
      decisions: [],
      actions: [ACTION_NO_OWNER],
      summaries: [],
    })
    expect(md).toContain('## Retrospectief')
    // Action line present without crashing
    expect(md).toContain('### Acties')
  })

  it('places off-agenda section after all named agenda items', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3, AGENDA_RETRO],
      participants: [],
      decisions: [DECISION_A, DECISION_OFF],
      actions: [],
      summaries: [],
    })

    const q3Pos = md.indexOf('## Q3 Planning')
    const retroPos = md.indexOf('## Retrospectief')
    const offPos = md.indexOf('## Off-agenda')

    expect(q3Pos).toBeGreaterThanOrEqual(0)
    expect(retroPos).toBeGreaterThan(q3Pos)
    expect(offPos).toBeGreaterThan(retroPos)
  })

  it('omits off-agenda section when there are no off-agenda items', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [],
      decisions: [DECISION_A],
      actions: [],
      summaries: [],
    })
    expect(md).not.toContain('Off-agenda')
  })

  it('includes discussion summary under the agenda heading', () => {
    const md = toMarkdown({
      title: 'Test',
      agendaItems: [AGENDA_Q3],
      participants: [],
      decisions: [],
      actions: [],
      summaries: [SUMMARY_Q3],
    })
    expect(md).toContain('Het team heeft de budgetopties besproken.')
  })

  it('produces minimal output for an empty meeting', () => {
    const md = toMarkdown({
      title: 'Lege vergadering',
      agendaItems: [],
      participants: [],
      decisions: [],
      actions: [],
      summaries: [],
    })
    expect(md).toMatch(/^# Lege vergadering/)
    expect(md).not.toContain('##')
  })
})

// ---------------------------------------------------------------------------
// toJson
// ---------------------------------------------------------------------------

describe('toJson', () => {
  it('produces valid JSON that parses without error', () => {
    const json = toJson({
      title: 'Test vergadering',
      agendaItems: [AGENDA_Q3],
      participants: [ALICE, BOB],
      decisions: [DECISION_A],
      actions: [ACTION_BOB],
      summaries: [SUMMARY_Q3],
    })

    expect(() => {
      JSON.parse(json)
    }).not.toThrow()
  })

  it('exported JSON satisfies ExportedMeetingSchema', () => {
    const json = toJson({
      title: 'Schema-test',
      agendaItems: [AGENDA_Q3],
      participants: [BOB],
      decisions: [DECISION_A],
      actions: [ACTION_BOB],
      summaries: [],
    })

    const parsed = ExportedMeetingSchema.parse(JSON.parse(json))
    expect(() => ExportedMeetingSchema.parse(parsed)).not.toThrow()
  })

  it('includes all agenda items, participants, decisions and actions', () => {
    const json = toJson({
      title: 'Volledig',
      agendaItems: [AGENDA_Q3, AGENDA_RETRO],
      participants: [ALICE, BOB],
      decisions: [DECISION_A, DECISION_OFF],
      actions: [ACTION_BOB],
      summaries: [SUMMARY_Q3],
    })

    const parsed = ExportedMeetingSchema.parse(JSON.parse(json))

    expect(parsed.agendaItems).toHaveLength(2)
    expect(parsed.participants).toHaveLength(2)
    expect(parsed.decisions).toHaveLength(2)
    expect(parsed.actions).toHaveLength(1)
  })

  it('includes exportedAt timestamp', () => {
    const json = toJson({
      title: 'Tijdstempel',
      agendaItems: [],
      participants: [],
      decisions: [],
      actions: [],
      summaries: [],
    })

    const parsed = JSON.parse(json) as { exportedAt: string }
    expect(typeof parsed.exportedAt).toBe('string')
    expect(parsed.exportedAt.length).toBeGreaterThan(0)
  })
})
