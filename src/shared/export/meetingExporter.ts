/**
 * Meeting export serializers (item 0022).
 *
 * Pure functions — no vendor SDKs, no Electron APIs.
 * Takes domain objects and returns plain strings.
 *
 * toMarkdown: agenda headings, Discussion Summary + Decisions + Actions per
 *   item, owners/due dates inline, off-agenda last.
 */

import { OffAgenda } from '../domain/types'
import type {
  AgendaItem,
  Participant,
  Decision,
  Action,
  DiscussionSummary,
  TranscriptSpan,
} from '../domain/types'

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface ExportInput {
  title: string
  agendaItems: AgendaItem[]
  participants: Participant[]
  decisions: Decision[]
  actions: Action[]
  summaries: DiscussionSummary[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the date-only portion of an ISO 8601 string: "2026-07-01T…" → "2026-07-01". */
function isoDatePart(iso: string): string {
  return iso.split('T')[0] ?? iso
}

/** Look up a participant's display name by id; falls back to the raw id. */
function participantName(participants: Participant[], id: string): string {
  return participants.find((p) => p.id === id)?.name ?? id
}

// ---------------------------------------------------------------------------
// Markdown serializer
// ---------------------------------------------------------------------------

/**
 * Serialise a meeting to a Markdown string.
 *
 * Structure:
 *   # Title
 *
 *   ## Agenda Item 1
 *   **Discussiesamenvatting:** …
 *   ### Beslissingen
 *   - rationale
 *   ### Acties
 *   - Action description _(Owner, vervalt: YYYY-MM-DD)_
 *   ---
 *
 *   ## Off-agenda   ← always last; omitted when empty
 *   …
 */
export function toMarkdown(input: ExportInput): string {
  const { title, agendaItems, participants, decisions, actions, summaries } = input

  const lines: string[] = [`# ${title}`, '']

  // Named agenda items first, off-agenda sentinel always last
  const groups: { id: string; title: string }[] = [
    ...agendaItems.map((ai) => ({ id: ai.id, title: ai.title })),
    { id: OffAgenda.id, title: OffAgenda.title },
  ]

  const knownAgendaIds = new Set(agendaItems.map((a) => a.id))
  // Off-agenda also catches orphans: an item whose agenda item isn't in the list
  // surfaces here instead of being silently dropped from the export.
  const belongsToGroup = (itemAgendaId: string, groupId: string): boolean =>
    groupId === OffAgenda.id
      ? itemAgendaId === OffAgenda.id || !knownAgendaIds.has(itemAgendaId)
      : itemAgendaId === groupId

  for (const group of groups) {
    const groupDecisions = decisions.filter((d) => belongsToGroup(d.agendaItemId, group.id))
    const groupActions = actions.filter((a) => belongsToGroup(a.agendaItemId, group.id))
    const summary = summaries.find((s) => belongsToGroup(s.agendaItemId, group.id))

    // Omit off-agenda section when there is nothing in it
    if (group.id === OffAgenda.id && groupDecisions.length === 0 && groupActions.length === 0) {
      continue
    }

    lines.push(`## ${group.title}`)
    lines.push('')

    if (summary !== undefined && summary.text.length > 0) {
      lines.push(`**Discussiesamenvatting:** ${summary.text}`)
      lines.push('')
    }

    if (groupDecisions.length > 0) {
      lines.push('### Beslissingen')
      lines.push('')
      for (const d of groupDecisions) {
        lines.push(`- ${d.rationale}`)
      }
      lines.push('')
    }

    if (groupActions.length > 0) {
      lines.push('### Acties')
      lines.push('')
      for (const a of groupActions) {
        const ownerStr = a.owner !== undefined ? participantName(participants, a.owner) : undefined
        const dueStr = a.dueDate !== undefined ? `vervalt: ${isoDatePart(a.dueDate)}` : undefined

        const metaParts = [ownerStr, dueStr].filter((p): p is string => p !== undefined)
        const meta = metaParts.length > 0 ? ` _(${metaParts.join(', ')})_` : ''

        const label =
          a.description !== undefined && a.description.length > 0 ? a.description : 'Actie'
        lines.push(`- ${label}${meta}`)
      }
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  // Strip trailing separator + blank lines
  while (lines.length > 0) {
    const last = lines[lines.length - 1]
    if (last === '---' || last === '') {
      lines.pop()
    } else {
      break
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Transcript serializer
// ---------------------------------------------------------------------------

/**
 * Serialise transcript spans to plain text: one line per span, ordered by start
 * time, with an optional "Speaker: " prefix when a speaker label is present.
 *
 * Used for the "copy transcript" action once transcription is complete. Pure —
 * no clipboard or Electron APIs here.
 */
export function toTranscriptText(spans: TranscriptSpan[]): string {
  return [...spans]
    .sort((a, b) => a.startMs - b.startMs)
    .map((s) => (s.speakerLabel !== undefined ? `${s.speakerLabel}: ${s.text}` : s.text))
    .join('\n')
}
