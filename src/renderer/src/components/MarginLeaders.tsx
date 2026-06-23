/**
 * MarginLeaders — the delicate curved leaders that join each margin item card to
 * the transcript span it was derived from (Cahier Final Master Spec).
 *
 * It is a thin DOM-measuring overlay and nothing more: it finds the source spans
 * (`[data-span-id]`) and the item cards (`[data-leader-card]`) inside the
 * positioned `containerRef`, measures them, and hands the rects to the pure
 * `computeLeaders`. All real logic lives there; this layer just measures and
 * paints, because jsdom has no layout to test against.
 *
 * Coordinates are relative to the container, so they survive page scroll (the
 * container and content move together). We recompute on data changes
 * (`recomputeKey`), container resize, and window resize. Below ~980px the margin
 * stacks under the transcript and the overlay is hidden by CSS.
 *
 * Renderer is UI only; no Node APIs.
 */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react'

import { computeLeaders, type Leader, type LeaderRect } from './leaderGeometry'

interface MarginLeadersProps {
  /** The positioned container holding both the transcript spans and the cards. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Changes whenever the items/transcript change, to trigger a remeasure. */
  recomputeKey: string
}

function toRect(r: DOMRect): LeaderRect {
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  }
}

export function MarginLeaders({
  containerRef,
  recomputeKey,
}: MarginLeadersProps): React.JSX.Element | null {
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  const recompute = useCallback(() => {
    const el = containerRef.current
    if (el === null) {
      setLeaders([])
      return
    }
    const containerRect = el.getBoundingClientRect()
    setSize({ width: containerRect.width, height: containerRect.height })

    const spans = new Map<string, LeaderRect>()
    el.querySelectorAll<HTMLElement>('[data-span-id]').forEach((spanEl) => {
      const id = spanEl.dataset.spanId
      if (id !== undefined) spans.set(id, toRect(spanEl.getBoundingClientRect()))
    })

    const cards: Parameters<typeof computeLeaders>[0]['cards'] = []
    el.querySelectorAll<HTMLElement>('[data-leader-card]').forEach((cardEl) => {
      const itemId = cardEl.dataset.leaderCard
      const sourceSpanId = cardEl.dataset.sourceSpanId
      if (itemId === undefined || sourceSpanId === undefined) return
      cards.push({
        itemId,
        sourceSpanId,
        confirmed: cardEl.dataset.confirmed === 'true',
        rect: toRect(cardEl.getBoundingClientRect()),
      })
    })

    setLeaders(
      computeLeaders({
        container: { left: containerRect.left, top: containerRect.top },
        spans,
        cards,
      }),
    )
  }, [containerRef])

  useLayoutEffect(() => {
    recompute()
  }, [recompute, recomputeKey])

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        recompute()
      })
      observer.observe(el)
    }
    window.addEventListener('resize', recompute)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [containerRef, recompute])

  if (leaders.length === 0) return null

  return (
    <svg
      className="margin-leaders"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
      aria-hidden="true"
    >
      {leaders.map((leader) => (
        <path
          key={leader.itemId}
          d={leader.d}
          className={`margin-leaders__path${leader.confirmed ? ' margin-leaders__path--confirmed' : ''}`}
        />
      ))}
    </svg>
  )
}
