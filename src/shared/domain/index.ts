/**
 * Domain module: pure types and validation schemas.
 *
 * This module exports the core domain model as Zod schemas and derived TypeScript types.
 * All entities are immutable value objects with no behavior.
 */

// Re-export all types and schemas from types.ts
export {
  // IDs
  MeetingIdSchema,
  type MeetingId,
  AgendaItemIdSchema,
  type AgendaItemId,
  ParticipantIdSchema,
  type ParticipantId,
  DecisionIdSchema,
  type DecisionId,
  ActionIdSchema,
  type ActionId,
  TranscriptSpanIdSchema,
  type TranscriptSpanId,
  DiscussionSummaryIdSchema,
  type DiscussionSummaryId,
  NudgeIdSchema,
  type NudgeId,
  // Enums
  MeetingStateSchema,
  type MeetingState,
  ItemStateSchema,
  type ItemState,
  ActionStatusSchema,
  type ActionStatus,
  // Entities
  TranscriptSpanSchema,
  type TranscriptSpan,
  ParticipantSchema,
  type Participant,
  AgendaItemSchema,
  type AgendaItem,
  OffAgenda,
  DecisionSchema,
  type Decision,
  ActionSchema,
  type Action,
  DiscussionSummarySchema,
  type DiscussionSummary,
  RunningSummarySchema,
  type RunningSummary,
  NudgeSchema,
  type Nudge,
  MeetingSchema,
  type Meeting,
} from './types'
