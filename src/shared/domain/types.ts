/**
 * Domain types for LiveTranscriber.
 *
 * Single source of truth: Zod schemas define the structure; TypeScript types
 * are derived from the schemas via z.infer. This ensures types and validation
 * never drift.
 */

import { z } from 'zod'

// ============================================================================
// BRANDED ID TYPES
// ============================================================================
// Using a refinement approach: string that must be non-empty

export const MeetingIdSchema = z.string().min(1, 'MeetingId cannot be empty')
export type MeetingId = z.infer<typeof MeetingIdSchema>

export const AgendaItemIdSchema = z.string().min(1, 'AgendaItemId cannot be empty')
export type AgendaItemId = z.infer<typeof AgendaItemIdSchema>

export const ParticipantIdSchema = z.string().min(1, 'ParticipantId cannot be empty')
export type ParticipantId = z.infer<typeof ParticipantIdSchema>

export const DecisionIdSchema = z.string().min(1, 'DecisionId cannot be empty')
export type DecisionId = z.infer<typeof DecisionIdSchema>

export const ActionIdSchema = z.string().min(1, 'ActionId cannot be empty')
export type ActionId = z.infer<typeof ActionIdSchema>

export const TranscriptSpanIdSchema = z.string().min(1, 'TranscriptSpanId cannot be empty')
export type TranscriptSpanId = z.infer<typeof TranscriptSpanIdSchema>

export const DiscussionSummaryIdSchema = z.string().min(1, 'DiscussionSummaryId cannot be empty')
export type DiscussionSummaryId = z.infer<typeof DiscussionSummaryIdSchema>

export const NudgeIdSchema = z.string().min(1, 'NudgeId cannot be empty')
export type NudgeId = z.infer<typeof NudgeIdSchema>

// ============================================================================
// ENUMS
// ============================================================================

export const MeetingStateSchema = z.enum(['draft', 'live', 'ended'])
export type MeetingState = z.infer<typeof MeetingStateSchema>

export const ItemStateSchema = z.enum(['proposed', 'confirmed'])
export type ItemState = z.infer<typeof ItemStateSchema>

export const ActionStatusSchema = z.enum(['open', 'done'])
export type ActionStatus = z.infer<typeof ActionStatusSchema>

// ============================================================================
// TRANSCRIPT SPAN
// ============================================================================

export const TranscriptSpanSchema = z.object({
  id: TranscriptSpanIdSchema,
  /** The transcribed text for this span. */
  text: z.string().min(1, 'TranscriptSpan text cannot be empty'),
  /** Start time in milliseconds from the beginning of the meeting. */
  startMs: z.number().nonnegative(),
  /** End time in milliseconds from the beginning of the meeting. */
  endMs: z.number().nonnegative(),
  /** ASR confidence score (0–1), if provided by the provider. */
  confidence: z.number().min(0).max(1).optional(),
  /** Speaker label (e.g., "Speaker 1"), if diarization is enabled. */
  speakerLabel: z.string().optional(),
  /**
   * Whether this span is a final (stable) transcript result.
   *
   * true  = the ASR provider has committed to this text; safe to store and
   *         feed to the extraction loop.
   * false = interim/partial result; text will likely change as more audio
   *         arrives. Useful for live display but not for extraction.
   * undefined = finality not tracked by the producing provider (treat as final).
   *
   * Only present when the ASR provider distinguishes interim from final
   * results (e.g. Deepgram with is_final). Local providers (Parakeet) may
   * omit it; absence means final.
   */
  isFinal: z.boolean().optional(),
})

export type TranscriptSpan = z.infer<typeof TranscriptSpanSchema>

// ============================================================================
// PARTICIPANT
// ============================================================================

export const ParticipantSchema = z.object({
  id: ParticipantIdSchema,
  /** The person's name, e.g., "Jeroen". */
  name: z.string().min(1, 'Participant name cannot be empty'),
})

export type Participant = z.infer<typeof ParticipantSchema>

// ============================================================================
// AGENDA ITEM
// ============================================================================

export const AgendaItemSchema = z.object({
  id: AgendaItemIdSchema,
  /** The agenda item title/heading, e.g., "Review Q3 results". */
  title: z.string().min(1, 'AgendaItem title cannot be empty'),
  /** The topic/description, e.g., "Performance review". */
  topic: z.string().min(1, 'AgendaItem topic cannot be empty'),
})

export type AgendaItem = z.infer<typeof AgendaItemSchema>

/**
 * Off-agenda sentinel: a special agenda item that represents the bucket
 * for Decisions and Actions that don't belong to any planned agenda item.
 * Per CONTEXT.md: "A built-in Off-agenda bucket catches Decisions and Actions
 * that map to no planned item."
 */
export const OffAgenda = AgendaItemSchema.parse({
  id: '__off-agenda__',
  title: 'Off-agenda',
  topic: 'Items not tied to a specific agenda item',
})

// ============================================================================
// DECISION
// ============================================================================

export const DecisionSchema = z.object({
  id: DecisionIdSchema,
  /** The rationale or summary of the decision. */
  rationale: z.string(),
  /** The agenda item this decision belongs to (or OffAgenda.id). */
  agendaItemId: AgendaItemIdSchema,
  /** Link back to the transcript span it was derived from. */
  sourceSpanId: TranscriptSpanIdSchema,
  /** Lifecycle state: proposed (from extraction provider) or confirmed (by note-taker). */
  state: ItemStateSchema.default('proposed'),
})

export type Decision = z.infer<typeof DecisionSchema>

// ============================================================================
// ACTION
// ============================================================================

export const ActionSchema = z.object({
  id: ActionIdSchema,
  /** The agenda item this action belongs to (or OffAgenda.id). */
  agendaItemId: AgendaItemIdSchema,
  /** Link back to the transcript span it was derived from. */
  sourceSpanId: TranscriptSpanIdSchema,
  /** The person responsible for this action. Optional until the note-taker assigns it. */
  owner: ParticipantIdSchema.optional(),
  /** When this action is due, if set. */
  dueDate: z.string().datetime().optional(),
  /** Completion status: open (not yet done) or done (completed). */
  status: ActionStatusSchema,
  /** Lifecycle state: proposed (from extraction provider) or confirmed (by note-taker). */
  state: ItemStateSchema.default('proposed'),
})

export type Action = z.infer<typeof ActionSchema>

// ============================================================================
// DISCUSSION SUMMARY
// ============================================================================
/**
 * Per CONTEXT.md: "A short summary of what was discussed under one Agenda Item,
 * generated by the final extraction pass when the Meeting reaches Ended (never live).
 * One per Agenda Item. Reviewable and editable post-meeting, and part of the
 * exported notes."
 */
export const DiscussionSummarySchema = z.object({
  id: DiscussionSummaryIdSchema,
  /** The agenda item this summary covers. */
  agendaItemId: AgendaItemIdSchema,
  /** The summary text, generated on the final pass. */
  text: z.string(),
})

export type DiscussionSummary = z.infer<typeof DiscussionSummarySchema>

// ============================================================================
// RUNNING SUMMARY
// ============================================================================
/**
 * Per CONTEXT.md: "A continuously updated, plain-language summary of the
 * meeting so far, exposed through an 'ask the meeting' panel where the
 * note-taker can query what has been said or decided. Derived from the
 * Transcript; never authoritative over Decisions/Actions."
 */
export const RunningSummarySchema = z.object({
  /** The current running summary text. */
  text: z.string(),
  /** When this summary was last updated. */
  updatedAt: z.string().datetime(),
})

export type RunningSummary = z.infer<typeof RunningSummarySchema>

// ============================================================================
// NUDGE
// ============================================================================
/**
 * Per CONTEXT.md: "A reactive, dismissible prompt the agent raises about the
 * state of the notes (e.g., 'this Action has no Owner', 'this Decision
 * contradicts an earlier one'). Never changes anything on its own; the
 * note-taker acts or dismisses."
 */
export const NudgeKindSchema = z.enum([
  'action-no-owner',
  'conflicting-decisions',
  'empty-agenda-item',
])
export type NudgeKind = z.infer<typeof NudgeKindSchema>

export const NudgeSchema = z.object({
  id: NudgeIdSchema,
  /** Discriminator for the nudge rule that fired. */
  kind: NudgeKindSchema,
  /** IDs of the related decisions, actions, or agenda items that triggered this nudge. */
  relatedItemIds: z.array(z.string().min(1)),
  /**
   * i18n key for the message to display (e.g. 'nudge.action-no-owner').
   * Never a raw string — always resolved through the i18n layer in the renderer.
   */
  message: z.string().min(1),
  /**
   * ISO 8601 datetime set by the consumer when the note-taker dismisses the nudge.
   * Absent until dismissed. Dismissal is in-memory only; nudges regenerate from state.
   */
  dismissedAt: z.string().datetime().optional(),
})

export type Nudge = z.infer<typeof NudgeSchema>

// ============================================================================
// MEETING
// ============================================================================

export const MeetingSchema = z.object({
  id: MeetingIdSchema,
  /** The meeting's title. */
  title: z.string().min(1, 'Meeting title cannot be empty'),
  /** Lifecycle state: draft (setup), live (capturing), or ended (final). */
  state: MeetingStateSchema,
  /**
   * Whether the meeting is currently paused. Only meaningful when state = 'live'.
   * Pause is a sub-state within Live, not a fourth top-level state.
   * Pause halts audio capture and the extraction cadence; resume continues the
   * same transcript without creating a new meeting.
   */
  paused: z.boolean().default(false),
  /** ISO 8601 timestamp when the meeting was created. */
  createdAt: z.string().datetime(),
  /** ISO 8601 timestamp when the meeting was last modified, if applicable. */
  updatedAt: z.string().datetime().optional(),
  /** ISO 8601 timestamp when Draft → Live transition occurred, if applicable. */
  startedAt: z.string().datetime().optional(),
  /** ISO 8601 timestamp when the meeting ended, if applicable. */
  endedAt: z.string().datetime().optional(),
  /** The primary language for extraction/UI (e.g., 'nl', 'en'). */
  primaryLanguage: z.string().min(1),
})

export type Meeting = z.infer<typeof MeetingSchema>
