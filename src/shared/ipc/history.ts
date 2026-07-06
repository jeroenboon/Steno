/**
 * Past-meeting (history) IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Invoke channels: meeting:list, meeting:load, meeting:delete.
 */

import { z } from 'zod'

import { MeetingSchema, AgendaItemSchema, ParticipantSchema } from '../domain'
import { DecisionSchema, ActionSchema, DiscussionSummarySchema } from '../domain/types'

import type { IpcChannelSchema } from './common'

// ---------------------------------------------------------------------------
// meeting:list — returns all meetings ordered newest-first (item 0023)
// ---------------------------------------------------------------------------

export const MeetingListRequestSchema = z.object({})

export const MeetingListResponseSchema = z.object({
  meetings: z.array(MeetingSchema),
})

export type MeetingListRequest = z.infer<typeof MeetingListRequestSchema>
export type MeetingListResponse = z.infer<typeof MeetingListResponseSchema>

// ---------------------------------------------------------------------------
// meeting:load — load full state of a past meeting for review (item 0023)
//
// Returns the meeting + all its decisions, actions, agenda items, participants,
// and discussion summaries so the Review screen can render a reopened meeting.
// ---------------------------------------------------------------------------

export const MeetingLoadRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})

export const MeetingLoadResponseSchema = z.object({
  meeting: MeetingSchema,
  decisions: z.array(DecisionSchema),
  actions: z.array(ActionSchema),
  agendaItems: z.array(AgendaItemSchema),
  participants: z.array(ParticipantSchema),
  summaries: z.array(DiscussionSummarySchema),
})

export type MeetingLoadRequest = z.infer<typeof MeetingLoadRequestSchema>
export type MeetingLoadResponse = z.infer<typeof MeetingLoadResponseSchema>

// ---------------------------------------------------------------------------
// meeting:delete — permanently delete a meeting and all its data (item 0026)
//
// Main deletes the meeting and cascade-deletes its agenda items, participants,
// transcript spans, decisions, actions, and discussion summaries.
// ---------------------------------------------------------------------------

export const MeetingDeleteRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})

export const MeetingDeleteResponseSchema = z.object({ ok: z.literal(true) })

export type MeetingDeleteRequest = z.infer<typeof MeetingDeleteRequestSchema>
export type MeetingDeleteResponse = z.infer<typeof MeetingDeleteResponseSchema>

// ---------------------------------------------------------------------------
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type HistoryChannel = 'meeting:list' | 'meeting:load' | 'meeting:delete'

export const historyChannelSchemas = {
  'meeting:list': { request: MeetingListRequestSchema, response: MeetingListResponseSchema },
  'meeting:load': { request: MeetingLoadRequestSchema, response: MeetingLoadResponseSchema },
  'meeting:delete': { request: MeetingDeleteRequestSchema, response: MeetingDeleteResponseSchema },
} satisfies Record<HistoryChannel, IpcChannelSchema>

export interface HistoryApi {
  /**
   * List all meetings ordered newest-first (item 0023).
   * Used by the Home screen to show past meetings.
   */
  meetingList: (req: MeetingListRequest) => Promise<MeetingListResponse>
  /**
   * Load full state of a past meeting (item 0023).
   * Returns the meeting + all decisions, actions, agenda items, participants,
   * and discussion summaries so the Review screen can render a reopened meeting.
   */
  meetingLoad: (req: MeetingLoadRequest) => Promise<MeetingLoadResponse>
  /**
   * Permanently delete a meeting and all its data (item 0026).
   * Used by the Home screen to remove meetings from the overview.
   */
  meetingDelete: (req: MeetingDeleteRequest) => Promise<MeetingDeleteResponse>
}
