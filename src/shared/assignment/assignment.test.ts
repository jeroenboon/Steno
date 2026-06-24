/**
 * Tests for the owner- and agenda-item assignment resolvers (item 0009).
 *
 * Pure logic — no DB, no I/O. All tests are deterministic.
 *
 * Matching strategy under test:
 *   resolveOwner:
 *     1. Normalise hint and each participant name (trim + lowercase).
 *     2. Exact full-name match → return that ParticipantId.
 *     3. First-name match (first whitespace-delimited token) → return that
 *        ParticipantId, but ONLY when exactly one participant matches.
 *        Two or more first-name matches → undefined (ambiguous).
 *     4. No match → undefined. Never invent a participant.
 *
 *   resolveAgendaItem:
 *     1. Normalise hint, title, and topic (trim + lowercase).
 *     2. Exact match against title OR topic → return that AgendaItemId,
 *        but ONLY when exactly one item matches.
 *     3. Substring containment (hint contained in title or topic, or title/topic
 *        contained in hint) as a fallback → again only when unambiguous.
 *     4. No match → OffAgenda.id. No hint → OffAgenda.id.
 */

import { describe, it, expect } from 'vitest'

import type { AgendaItem, Participant } from '@shared/domain'
import { OffAgenda } from '@shared/domain'

import { resolveOwner, resolveAgendaItem } from './index'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const JEROEN: Participant = { id: 'p-jeroen', name: 'Jeroen Boon' }
const ANIKA: Participant = { id: 'p-anika', name: 'Anika de Vries' }
const JEROEN2: Participant = { id: 'p-jeroen2', name: 'Jeroen Smit' }

const AI_Q3: AgendaItem = {
  id: 'ai-q3',
  title: 'Q3 review',
  topic: 'Review Q3 results',
  state: 'confirmed',
}
const AI_BUDGET: AgendaItem = {
  id: 'ai-budget',
  title: 'Budget',
  topic: 'Budget discussion',
  state: 'confirmed',
}
const AI_BUDGET2: AgendaItem = {
  id: 'ai-budget2',
  title: 'Budget',
  topic: 'Budget overview',
  state: 'confirmed',
}

// ---------------------------------------------------------------------------
// resolveOwner
// ---------------------------------------------------------------------------

describe('resolveOwner', () => {
  it('returns undefined when hint is undefined', () => {
    expect(resolveOwner(undefined, [JEROEN, ANIKA])).toBeUndefined()
  })

  it('returns undefined when hint is empty string', () => {
    expect(resolveOwner('', [JEROEN, ANIKA])).toBeUndefined()
  })

  it('returns undefined when hint is whitespace only', () => {
    expect(resolveOwner('   ', [JEROEN, ANIKA])).toBeUndefined()
  })

  it('returns undefined when no participant matches the hint', () => {
    expect(resolveOwner('Unknown Person', [JEROEN, ANIKA])).toBeUndefined()
  })

  it('does NOT invent a participant — no match means undefined, not a new id', () => {
    const result = resolveOwner('Ghost', [JEROEN, ANIKA])
    expect(result).toBeUndefined()
    // Defensive: it must not equal any existing participant id either
    expect(result).not.toBe(JEROEN.id)
    expect(result).not.toBe(ANIKA.id)
  })

  it('returns the ParticipantId on an exact full-name match', () => {
    expect(resolveOwner('Jeroen Boon', [JEROEN, ANIKA])).toBe(JEROEN.id)
  })

  it('matches case-insensitively (all-lowercase hint)', () => {
    expect(resolveOwner('jeroen boon', [JEROEN, ANIKA])).toBe(JEROEN.id)
  })

  it('matches case-insensitively (all-uppercase hint)', () => {
    expect(resolveOwner('ANIKA DE VRIES', [JEROEN, ANIKA])).toBe(ANIKA.id)
  })

  it('trims leading/trailing whitespace from the hint', () => {
    expect(resolveOwner('  Jeroen Boon  ', [JEROEN, ANIKA])).toBe(JEROEN.id)
  })

  it('matches by first name only when exactly one participant has that first name', () => {
    expect(resolveOwner('Anika', [JEROEN, ANIKA])).toBe(ANIKA.id)
  })

  it('matches first name case-insensitively', () => {
    expect(resolveOwner('anika', [JEROEN, ANIKA])).toBe(ANIKA.id)
  })

  it('returns undefined when first-name hint is ambiguous (two participants share that first name)', () => {
    // Both JEROEN and JEROEN2 start with "Jeroen"
    expect(resolveOwner('Jeroen', [JEROEN, JEROEN2, ANIKA])).toBeUndefined()
  })

  it('returns the ParticipantId on exact full-name match even when a first-name ambiguity would exist', () => {
    // Full name "Jeroen Boon" is unambiguous even though "Jeroen" alone would not be
    expect(resolveOwner('Jeroen Boon', [JEROEN, JEROEN2, ANIKA])).toBe(JEROEN.id)
  })

  it('returns undefined when participant list is empty', () => {
    expect(resolveOwner('Jeroen', [])).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveAgendaItem
// ---------------------------------------------------------------------------

describe('resolveAgendaItem', () => {
  it('returns OffAgenda.id when hint is undefined', () => {
    expect(resolveAgendaItem(undefined, [AI_Q3, AI_BUDGET])).toBe(OffAgenda.id)
  })

  it('returns OffAgenda.id when hint is empty string', () => {
    expect(resolveAgendaItem('', [AI_Q3, AI_BUDGET])).toBe(OffAgenda.id)
  })

  it('returns OffAgenda.id when hint is whitespace only', () => {
    expect(resolveAgendaItem('   ', [AI_Q3, AI_BUDGET])).toBe(OffAgenda.id)
  })

  it('returns OffAgenda.id when no agenda item matches', () => {
    expect(resolveAgendaItem('completely unrelated topic', [AI_Q3, AI_BUDGET])).toBe(OffAgenda.id)
  })

  it('returns OffAgenda.id when agenda list is empty', () => {
    expect(resolveAgendaItem('Q3 review', [])).toBe(OffAgenda.id)
  })

  it('returns the AgendaItemId on an exact title match', () => {
    expect(resolveAgendaItem('Q3 review', [AI_Q3, AI_BUDGET])).toBe(AI_Q3.id)
  })

  it('returns the AgendaItemId on an exact topic match', () => {
    expect(resolveAgendaItem('Review Q3 results', [AI_Q3, AI_BUDGET])).toBe(AI_Q3.id)
  })

  it('matches title case-insensitively', () => {
    expect(resolveAgendaItem('q3 review', [AI_Q3, AI_BUDGET])).toBe(AI_Q3.id)
  })

  it('trims whitespace from the hint', () => {
    expect(resolveAgendaItem('  Budget  ', [AI_Q3, AI_BUDGET])).toBe(AI_BUDGET.id)
  })

  it('returns OffAgenda.id when hint matches more than one agenda item (ambiguous)', () => {
    // 'budget' is a substring of both AI_BUDGET title and AI_BUDGET2 title
    expect(resolveAgendaItem('budget', [AI_Q3, AI_BUDGET, AI_BUDGET2])).toBe(OffAgenda.id)
  })

  it('returns the AgendaItemId on a substring match when unambiguous', () => {
    // 'q3' is only a substring of the Q3 item
    expect(resolveAgendaItem('q3', [AI_Q3, AI_BUDGET])).toBe(AI_Q3.id)
  })
})
