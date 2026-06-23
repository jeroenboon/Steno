/**
 * Leader geometry — pure math for the marginalia leaders (Cahier Final Master
 * Spec). A leader curves from the right edge of a transcript span to the left
 * edge of the margin card that span spawned, tying each Decision/Action back to
 * the words it came from (every item links to a source span, per CONTEXT.md).
 *
 * Pure by design: rects in, SVG path strings out. The DOM-measuring overlay
 * (MarginLeaders) does nothing but feed this and render the result, so all the
 * logic worth testing lives here (jsdom has no layout to measure).
 */

export interface Point {
  x: number
  y: number
}

export interface LeaderRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface LeaderCard {
  itemId: string
  sourceSpanId: string
  confirmed: boolean
  rect: LeaderRect
}

export interface ComputeLeadersInput {
  /** Rect of the positioned container the SVG overlay sits in (its origin). */
  container: { left: number; top: number }
  /** Source span id -> measured rect. */
  spans: Map<string, LeaderRect>
  /** The margin cards to connect. */
  cards: LeaderCard[]
}

export interface Leader {
  itemId: string
  d: string
  confirmed: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * A cubic bezier that leaves `from` horizontally and arrives at `to`
 * horizontally: both control points sit halfway across, level with their
 * endpoint. This gives the gentle S-curve of a hand-drawn leader.
 */
export function buildLeaderPath(from: Point, to: Point): string {
  const dx = to.x - from.x
  const sx = String(round2(from.x))
  const sy = String(round2(from.y))
  const c1x = String(round2(from.x + dx * 0.5))
  const c1y = String(round2(from.y))
  const c2x = String(round2(to.x - dx * 0.5))
  const c2y = String(round2(to.y))
  const ex = String(round2(to.x))
  const ey = String(round2(to.y))
  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`
}

/**
 * Build a leader for every card that has a measurable source span. Coordinates
 * are returned relative to the container origin (so they survive page scroll,
 * which moves container and content together). Cards with no matching span
 * (manual items) or zero-size rects (collapsed / not yet laid out) are skipped.
 */
export function computeLeaders({ container, spans, cards }: ComputeLeadersInput): Leader[] {
  const leaders: Leader[] = []
  for (const card of cards) {
    const span = spans.get(card.sourceSpanId)
    if (span === undefined) continue
    if (span.width === 0 || span.height === 0) continue
    if (card.rect.width === 0 || card.rect.height === 0) continue

    const from: Point = {
      x: span.right - container.left,
      y: (span.top + span.bottom) / 2 - container.top,
    }
    const to: Point = {
      x: card.rect.left - container.left,
      y: (card.rect.top + card.rect.bottom) / 2 - container.top,
    }
    leaders.push({ itemId: card.itemId, confirmed: card.confirmed, d: buildLeaderPath(from, to) })
  }
  return leaders
}
