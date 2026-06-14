/**
 * Owner and agenda-item assignment resolvers (item 0009).
 *
 * Pure functions — no DB, no I/O, no side effects. The only inputs are the
 * provider's free-text hint strings and the lists already held in memory.
 *
 * ## Matching strategy
 *
 * ### resolveOwner
 *
 * Both the hint and each participant name are normalised (trim + lowercase)
 * before comparison. Two tiers, applied in order:
 *
 *   1. Exact full-name match — the normalised hint equals the normalised name
 *      of exactly one participant. Returns that ParticipantId.
 *   2. First-name match — the normalised hint equals the first whitespace-
 *      delimited token of exactly one participant's name. Returns that
 *      ParticipantId only when the match is unambiguous (one result).
 *
 * If neither tier yields exactly one match the function returns `undefined`.
 * A participant is NEVER invented — unknown or ambiguous hint → undefined.
 *
 * ### resolveAgendaItem
 *
 * Hint and each agenda item's `title` and `topic` are normalised
 * (trim + lowercase). Three tiers, applied in order:
 *
 *   1. Exact match — normalised hint equals normalised title or topic of
 *      exactly one agenda item.
 *   2. Substring containment — normalised hint is contained in (or contains)
 *      the normalised title or topic of exactly one agenda item.
 *
 * If neither tier yields exactly one match the function returns `OffAgenda.id`.
 * No hint or blank hint → `OffAgenda.id`.
 */

import type { AgendaItem, AgendaItemId, Participant, ParticipantId } from '@shared/domain'
import { OffAgenda } from '@shared/domain'

// ---------------------------------------------------------------------------
// Normalise helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function firstName(name: string): string {
  return norm(name).split(/\s+/)[0] ?? ''
}

// ---------------------------------------------------------------------------
// resolveOwner
// ---------------------------------------------------------------------------

/**
 * Resolve the provider's free-text owner hint to a validated ParticipantId.
 *
 * Returns `undefined` when:
 *   - hint is absent or blank
 *   - no participant matches (unknown name)
 *   - more than one participant matches (ambiguous)
 */
export function resolveOwner(
  ownerHint: string | undefined,
  participants: Participant[],
): ParticipantId | undefined {
  if (!ownerHint) return undefined

  const normalised = norm(ownerHint)
  if (normalised === '') return undefined

  // Tier 1: exact full-name match
  const exactMatches = participants.filter((p) => norm(p.name) === normalised)
  if (exactMatches.length === 1) {
    const match = exactMatches[0]
    if (match !== undefined) return match.id
  }
  // Two or more exact matches would mean duplicate names — treat as ambiguous
  if (exactMatches.length > 1) return undefined

  // Tier 2: first-name match — unambiguous only
  const firstNameMatches = participants.filter((p) => firstName(p.name) === normalised)
  if (firstNameMatches.length === 1) {
    const match = firstNameMatches[0]
    if (match !== undefined) return match.id
  }

  return undefined
}

// ---------------------------------------------------------------------------
// resolveAgendaItem
// ---------------------------------------------------------------------------

/**
 * Resolve the provider's free-text agenda-item hint to a validated AgendaItemId.
 *
 * Returns `OffAgenda.id` when:
 *   - hint is absent or blank
 *   - no agenda item matches
 *   - more than one agenda item matches (ambiguous)
 */
export function resolveAgendaItem(
  agendaItemHint: string | undefined,
  agendaItems: AgendaItem[],
): AgendaItemId {
  if (!agendaItemHint) return OffAgenda.id

  const normalised = norm(agendaItemHint)
  if (normalised === '') return OffAgenda.id

  // Tier 1: exact match against title or topic
  const exactMatches = agendaItems.filter(
    (ai) => norm(ai.title) === normalised || norm(ai.topic) === normalised,
  )
  if (exactMatches.length === 1) {
    const match = exactMatches[0]
    if (match !== undefined) return match.id
  }
  if (exactMatches.length > 1) return OffAgenda.id

  // Tier 2: substring containment (hint in title/topic, or title/topic in hint)
  const subMatches = agendaItems.filter((ai) => {
    const t = norm(ai.title)
    const top = norm(ai.topic)
    return (
      t.includes(normalised) ||
      top.includes(normalised) ||
      normalised.includes(t) ||
      normalised.includes(top)
    )
  })
  if (subMatches.length === 1) {
    const match = subMatches[0]
    if (match !== undefined) return match.id
  }

  return OffAgenda.id
}
