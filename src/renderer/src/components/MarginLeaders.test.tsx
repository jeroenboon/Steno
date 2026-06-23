/**
 * MarginLeaders — the DOM-measuring SVG overlay that draws marginalia leaders.
 *
 * jsdom has no layout, so we give each element its own getBoundingClientRect
 * (from a `data-test-rect` attribute) and nudge the overlay to remeasure via a
 * window resize. The geometry itself is covered in leaderGeometry.test.ts; here
 * we only check the overlay measures the right elements, renders a path per
 * measurable card, and renders nothing when there is nothing to measure.
 */

import { fireEvent, render } from '@testing-library/react'
import React, { useRef } from 'react'
import { describe, it, expect } from 'vitest'

import { buildLeaderPath } from './leaderGeometry'
import { MarginLeaders } from './MarginLeaders'

function fakeRect(spec: string): DOMRect {
  const [left, top, right, bottom] = spec.split(',').map(Number) as [number, number, number, number]
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

/** Give every element carrying data-test-rect a matching getBoundingClientRect. */
function applyLayout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-test-rect]').forEach((el) => {
    const spec = el.dataset.testRect
    if (spec !== undefined) el.getBoundingClientRect = () => fakeRect(spec)
  })
}

interface HarnessProps {
  confirmed?: boolean
  withSpan?: boolean
}

function Harness({ confirmed = false, withSpan = true }: HarnessProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-test-rect="10,20,510,600">
      <ul>
        {withSpan && (
          <li data-span-id="s1" data-test-rect="10,120,260,140">
            hallo
          </li>
        )}
      </ul>
      <div
        data-leader-card="i1"
        data-source-span-id="s1"
        data-confirmed={confirmed ? 'true' : 'false'}
        data-test-rect="300,200,500,240"
      >
        card
      </div>
      <MarginLeaders containerRef={ref} recomputeKey="k1" />
    </div>
  )
}

describe('MarginLeaders', () => {
  it('renders a leader path from the span to the card', () => {
    const { container } = render(<Harness />)
    applyLayout(container)
    fireEvent(window, new Event('resize'))

    const svg = container.querySelector('svg.margin-leaders')
    expect(svg).not.toBeNull()
    const paths = svg?.querySelectorAll('path') ?? []
    expect(paths).toHaveLength(1)
    // from = (260-10, 130-20) = (250,110); to = (300-10, 220-20) = (290,200)
    expect(paths[0]?.getAttribute('d')).toBe(
      buildLeaderPath({ x: 250, y: 110 }, { x: 290, y: 200 }),
    )
  })

  it('marks a confirmed card path with the confirmed modifier', () => {
    const { container } = render(<Harness confirmed />)
    applyLayout(container)
    fireEvent(window, new Event('resize'))

    const path = container.querySelector('svg.margin-leaders path')
    expect(path?.classList.contains('margin-leaders__path--confirmed')).toBe(true)
  })

  it('renders nothing when there is no matching source span', () => {
    const { container } = render(<Harness withSpan={false} />)
    applyLayout(container)
    fireEvent(window, new Event('resize'))

    expect(container.querySelector('svg.margin-leaders')).toBeNull()
  })

  it('renders nothing without layout (zero-size rects, e.g. jsdom default)', () => {
    const { container } = render(<Harness />)
    // No applyLayout: every getBoundingClientRect is the jsdom zero rect.
    expect(container.querySelector('svg.margin-leaders')).toBeNull()
  })
})
