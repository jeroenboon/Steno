import { describe, it, expect } from 'vitest'

import { normaliseAgendaTitle, isTitleCovered } from './agendaTitle'

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
