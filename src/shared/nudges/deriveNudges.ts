/**
 * Pure nudge-derivation functions (item 0019).
 *
 * Accepts the current meeting state and returns an array of Nudge objects.
 * No side effects, no vendor SDKs, no I/O — purely functional.
 *
 * ## ConflictingDecisions heuristic (V1)
 *
 * We fire this nudge when there are ≥2 confirmed decisions in the same agenda
 * item AND their rationales share no content words (words of ≥5 chars not in
 * the stopword list). If two decisions have nothing in common, they may be about
 * contradictory topics under the same item — worth a note-taker glance. A future
 * item will replace this with an LLM-driven approach. The heuristic is
 * intentionally broad and safe: it generates false positives (flagging unrelated-
 * but-not-contradictory decisions) rather than false negatives (missing real
 * contradictions).
 *
 * ## Nudge ID scheme
 *
 * IDs are derived from the nudge kind and the sorted relatedItemIds, joined by
 * colons: `kind:id1:id2`. This is deterministic — same state → same IDs — so
 * dismiss state in the renderer survives re-renders.
 */

import type {
  Action,
  AgendaItem,
  Decision,
  Nudge,
  Participant,
  TranscriptSpan,
  NudgeId,
} from '../domain/types'

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

export interface DeriveNudgesState {
  decisions: Decision[]
  actions: Action[]
  agendaItems: AgendaItem[]
  participants: Participant[]
  transcriptSpans: TranscriptSpan[]
  meetingStartedAt: Date
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Common Dutch + English stopwords that carry no semantic weight for the
 * ConflictingDecisions heuristic. Words in this set are excluded from the
 * content-word comparison even if they are ≥5 chars.
 */
const STOPWORDS = new Set([
  // Dutch
  'hebben',
  'worden',
  'kunnen',
  'moeten',
  'zullen',
  'willen',
  'gaan',
  'komen',
  'maken',
  'staat',
  'wordt',
  'heeft',
  'waren',
  'zijn',
  'deze',
  'omdat',
  'zodat',
  'indien',
  'wanneer',
  'terwijl',
  'tenzij',
  'alhoewel',
  'echter',
  'maar',
  'want',
  'hoewel',
  'waarom',
  'waardoor',
  'waarbij',
  'voor',
  'door',
  'over',
  'onder',
  'boven',
  'tussen',
  'naast',
  'langs',
  'geen',
  'niet',
  'nooit',
  'niets',
  'nergens',
  'niemand',
  'ieder',
  'elke',
  'iedere',
  'allemaal',
  'altijd',
  'soms',
  'hierbij',
  'daarbij',
  'daarna',
  'daarvoor',
  'daarna',
  'daarin',
  'daarmee',
  'hiervan',
  'hierop',
  // English
  'about',
  'above',
  'after',
  'again',
  'against',
  'could',
  'would',
  'should',
  'there',
  'their',
  'which',
  'while',
  'where',
  'these',
  'those',
  'other',
  'being',
  'doing',
  'having',
  'going',
  'taking',
  'making',
  'using',
  'every',
  'never',
  'always',
  'often',
  'since',
  'until',
  'under',
  'between',
  'through',
  'before',
  'after',
  'during',
  'without',
  'within',
  'along',
  'across',
])

/**
 * Extract content words from a rationale string.
 * Words must be ≥5 chars and not in the stopword set.
 */
function extractContentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-zA-Zà-öø-ÿÀ-ÖØ-ß\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w))
  return new Set(words)
}

/** Build a deterministic nudge ID from kind + sorted related item IDs. */
function buildNudgeId(kind: string, relatedIds: string[]): NudgeId {
  return `${kind}:${[...relatedIds].sort().join(':')}`
}

const FIVE_MINUTES_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Derive nudges from the current meeting state.
 *
 * @param state  - Full meeting state snapshot (decisions, actions, agenda items, etc.)
 * @param now    - Current time; injected so the function is deterministic in tests.
 * @returns      Array of Nudge objects. Empty array when no nudges apply.
 */
export function deriveNudges(state: DeriveNudgesState, now: Date): Nudge[] {
  const nudges: Nudge[] = []

  // -------------------------------------------------------------------------
  // Rule 1: OwnerMissing
  // A confirmed Action with no owner set is a nudge.
  // Proposed actions are fine — the note-taker may not have assigned one yet.
  // -------------------------------------------------------------------------
  for (const action of state.actions) {
    if (action.state === 'confirmed' && action.owner === undefined) {
      const id = buildNudgeId('action-no-owner', [action.id])
      nudges.push({
        id,
        kind: 'action-no-owner',
        relatedItemIds: [action.id],
        message: 'nudge.action-no-owner',
      })
    }
  }

  // -------------------------------------------------------------------------
  // Rule 2: ConflictingDecisions
  // See module docblock for the heuristic explanation.
  // Only confirmed decisions participate; proposed ones are not yet stable.
  // -------------------------------------------------------------------------
  const confirmedDecisions = state.decisions.filter((d) => d.state === 'confirmed')

  // Group by agenda item
  const byAgendaItem = new Map<string, Decision[]>()
  for (const d of confirmedDecisions) {
    const existing = byAgendaItem.get(d.agendaItemId)
    if (existing !== undefined) {
      existing.push(d)
    } else {
      byAgendaItem.set(d.agendaItemId, [d])
    }
  }

  for (const decisions of byAgendaItem.values()) {
    if (decisions.length < 2) continue

    // Check all pairs within this agenda item
    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        const a = decisions[i]
        const b = decisions[j]
        // Type guard: array access with noUncheckedIndexedAccess
        if (a === undefined || b === undefined) continue

        const wordsA = extractContentWords(a.rationale)
        const wordsB = extractContentWords(b.rationale)
        const hasSharedWord =
          wordsA.size > 0 && wordsB.size > 0 && [...wordsA].some((w) => wordsB.has(w))

        if (!hasSharedWord) {
          const relatedIds = [a.id, b.id]
          nudges.push({
            id: buildNudgeId('conflicting-decisions', relatedIds),
            kind: 'conflicting-decisions',
            relatedItemIds: relatedIds,
            message: 'nudge.conflicting-decisions',
          })
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rule 3: EmptyAgendaItem
  // Fire when the meeting has been running for > 5 minutes (at least one
  // transcript span exists) AND an agenda item has no decisions or actions.
  // The 5-minute threshold and span check prevent noise during early meeting setup.
  // -------------------------------------------------------------------------
  const meetingElapsedMs = now.getTime() - state.meetingStartedAt.getTime()
  if (meetingElapsedMs > FIVE_MINUTES_MS && state.transcriptSpans.length > 0) {
    const agendaItemsWithItems = new Set([
      ...state.decisions.map((d) => d.agendaItemId),
      ...state.actions.map((a) => a.agendaItemId),
    ])

    for (const agendaItem of state.agendaItems) {
      if (!agendaItemsWithItems.has(agendaItem.id)) {
        nudges.push({
          id: buildNudgeId('empty-agenda-item', [agendaItem.id]),
          kind: 'empty-agenda-item',
          relatedItemIds: [agendaItem.id],
          message: 'nudge.empty-agenda-item',
        })
      }
    }
  }

  return nudges
}
