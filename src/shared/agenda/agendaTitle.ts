/**
 * Agenda-title comparison helpers.
 *
 * Live agenda inference is append-only: the agent only ever adds agenda items
 * it has not already covered (ADR 0029). "Already covered" is decided by a
 * normalised-title compare — case- and whitespace-insensitive — shared by the
 * grounding filter in the extraction adapters and the proposal service's dedup
 * so the two paths can never drift.
 */

/** Lowercase, trim, and collapse internal whitespace to a single space. */
export function normaliseAgendaTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Whether `title` is already covered by one of `known` (compared on normalised
 * title). An empty known list is never a match.
 */
export function isTitleCovered(title: string, known: readonly { title: string }[]): boolean {
  const target = normaliseAgendaTitle(title)
  return known.some((k) => normaliseAgendaTitle(k.title) === target)
}
