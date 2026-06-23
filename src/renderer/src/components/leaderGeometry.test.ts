/**
 * Leader geometry — pure math behind the marginalia leaders (Cahier Final Master
 * Spec). A leader is a delicate curved line from the right edge of a transcript
 * span to the left edge of the margin card it spawned.
 *
 * Kept pure (rects in, path strings out) so it is fully unit-testable: jsdom has
 * no layout, so the DOM-measuring overlay (MarginLeaders) can't be tested this
 * precisely. All the interesting logic lives here.
 */

import { describe, it, expect } from 'vitest'

import { buildLeaderPath, computeLeaders, type LeaderRect } from './leaderGeometry'

function rect(left: number, top: number, right: number, bottom: number): LeaderRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

describe('buildLeaderPath', () => {
  it('draws a horizontally-bowed cubic bezier from start to end', () => {
    // Control points sit halfway across, level with each endpoint, so the curve
    // leaves the span horizontally and arrives at the card horizontally.
    expect(buildLeaderPath({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe('M 0 0 C 50 0, 50 50, 100 50')
  })

  it('rounds coordinates to two decimals for stable output', () => {
    expect(buildLeaderPath({ x: 0, y: 0 }, { x: 33, y: 11 })).toBe('M 0 0 C 16.5 0, 16.5 11, 33 11')
  })
})

describe('computeLeaders', () => {
  const container = { left: 10, top: 20 }

  it('builds one leader per card, from span right edge to card left edge', () => {
    const spans = new Map<string, LeaderRect>([['s1', rect(10, 120, 260, 140)]])
    const cards = [
      { itemId: 'i1', sourceSpanId: 's1', confirmed: false, rect: rect(300, 200, 500, 240) },
    ]

    const result = computeLeaders({ container, spans, cards })

    // from = (span.right - c.left, span.vmid - c.top) = (250, 110)
    // to   = (card.left - c.left, card.vmid - c.top) = (290, 200)
    expect(result).toEqual([
      {
        itemId: 'i1',
        confirmed: false,
        d: buildLeaderPath({ x: 250, y: 110 }, { x: 290, y: 200 }),
      },
    ])
  })

  it('skips cards whose source span is not present (e.g. manual items)', () => {
    const spans = new Map<string, LeaderRect>([['s1', rect(10, 120, 260, 140)]])
    const cards = [
      { itemId: 'i1', sourceSpanId: 'manual', confirmed: false, rect: rect(300, 200, 500, 240) },
    ]

    expect(computeLeaders({ container, spans, cards })).toEqual([])
  })

  it('skips when the source span has zero size (unmeasured / collapsed)', () => {
    const spans = new Map<string, LeaderRect>([['s1', rect(10, 120, 10, 120)]])
    const cards = [
      { itemId: 'i1', sourceSpanId: 's1', confirmed: false, rect: rect(300, 200, 500, 240) },
    ]

    expect(computeLeaders({ container, spans, cards })).toEqual([])
  })

  it('skips when the card has zero size (unmeasured)', () => {
    const spans = new Map<string, LeaderRect>([['s1', rect(10, 120, 260, 140)]])
    const cards = [
      { itemId: 'i1', sourceSpanId: 's1', confirmed: false, rect: rect(300, 200, 300, 200) },
    ]

    expect(computeLeaders({ container, spans, cards })).toEqual([])
  })

  it('preserves the confirmed flag so the path can recolour to Myrtle', () => {
    const spans = new Map<string, LeaderRect>([['s1', rect(10, 120, 260, 140)]])
    const cards = [
      { itemId: 'i1', sourceSpanId: 's1', confirmed: true, rect: rect(300, 200, 500, 240) },
    ]

    const result = computeLeaders({ container, spans, cards })
    expect(result[0]?.confirmed).toBe(true)
  })

  it('returns leaders only for measurable cards, in input order', () => {
    const spans = new Map<string, LeaderRect>([
      ['s1', rect(10, 100, 260, 120)],
      ['s2', rect(10, 300, 260, 320)],
    ])
    const cards = [
      { itemId: 'a', sourceSpanId: 's1', confirmed: false, rect: rect(300, 100, 500, 140) },
      {
        itemId: 'manual',
        sourceSpanId: 'manual',
        confirmed: false,
        rect: rect(300, 200, 500, 240),
      },
      { itemId: 'b', sourceSpanId: 's2', confirmed: true, rect: rect(300, 300, 500, 340) },
    ]

    expect(computeLeaders({ container, spans, cards }).map((l) => l.itemId)).toEqual(['a', 'b'])
  })
})
