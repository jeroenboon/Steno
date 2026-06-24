import { describe, it, expect } from 'vitest'

import { normaliseAgendaTitle, isTitleCovered, excludeCoveredAgendaItems } from './agendaTitle'

describe('normaliseAgendaTitle', () => {
  it('lowercases, trims and collapses internal whitespace', () => {
    expect(normaliseAgendaTitle('  Q3   Begroting ')).toBe('q3 begroting')
  })

  it('treats case and spacing differences as equal', () => {
    expect(normaliseAgendaTitle('Begroting')).toBe(normaliseAgendaTitle('  begroting '))
  })
})

describe('isTitleCovered', () => {
  it('is true when a known title matches after normalisation', () => {
    expect(isTitleCovered('Begroting', [{ title: '  begroting ' }])).toBe(true)
  })

  it('is false when no known title matches', () => {
    expect(isTitleCovered('Planning', [{ title: 'Begroting' }])).toBe(false)
  })

  it('is false against an empty known list', () => {
    expect(isTitleCovered('Planning', [])).toBe(false)
  })
})

describe('excludeCoveredAgendaItems', () => {
  it('drops agenda items whose title matches a known one, keeping the rest', () => {
    const ctx = {
      agendaItems: [
        { title: 'Begroting', topic: 'a' },
        { title: 'Planning', topic: 'b' },
      ],
      participants: [{ name: 'Jeroen' }],
      title: 'Overleg',
    }
    const result = excludeCoveredAgendaItems(ctx, [{ title: ' begroting ' }])
    expect(result.agendaItems.map((a) => a.title)).toEqual(['Planning'])
    // Other fields pass through untouched.
    expect(result.participants).toEqual([{ name: 'Jeroen' }])
    expect(result.title).toBe('Overleg')
  })

  it('returns the context unchanged when the known list is empty', () => {
    const ctx = { agendaItems: [{ title: 'Begroting', topic: 'a' }], participants: [] }
    expect(excludeCoveredAgendaItems(ctx, [])).toBe(ctx)
  })
})
