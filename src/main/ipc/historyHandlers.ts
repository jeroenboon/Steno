/**
 * History IPC handlers (audit A2b): meeting:list/load/delete (item 0023/0026).
 * Owns the HistoryOps port, satisfied by MeetingQueryService.
 */

import type { Meeting } from '@shared/domain'
import {
  MeetingListRequestSchema,
  MeetingListResponseSchema,
  MeetingLoadRequestSchema,
  MeetingLoadResponseSchema,
  MeetingDeleteRequestSchema,
  MeetingDeleteResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  MeetingListResponse,
  MeetingLoadResponse,
  MeetingDeleteResponse,
} from '@shared/ipc'

import type { Handler } from './handlerTypes'

/** Read-only history over past meetings. Satisfied by MeetingQueryService. */
export interface HistoryOps {
  /** All meetings past Draft, newest-first (meeting:list). */
  list(): Meeting[]
  /** Full state of one past meeting, or null when not found (meeting:load). */
  load(meetingId: string): MeetingLoadResponse | null
  /** Delete a meeting and its child rows (meeting:delete). */
  delete(meetingId: string): void
}

export interface HistoryHandlerDeps {
  history?: HistoryOps
}

export function createHistoryHandlers(
  deps: HistoryHandlerDeps,
): Partial<Record<IpcChannel, Handler>> {
  return {
    'meeting:list': (raw: unknown): MeetingListResponse => {
      MeetingListRequestSchema.parse(raw)
      const meetings = deps.history?.list() ?? []
      return MeetingListResponseSchema.parse({ meetings })
    },
    'meeting:load': (raw: unknown): MeetingLoadResponse => {
      const req = MeetingLoadRequestSchema.parse(raw)
      if (deps.history === undefined) {
        throw new Error('meeting:load is not available')
      }
      const result = deps.history.load(req.meetingId)
      if (result === null) {
        throw new Error(`Meeting not found: ${req.meetingId}`)
      }
      return MeetingLoadResponseSchema.parse(result)
    },
    'meeting:delete': (raw: unknown): MeetingDeleteResponse => {
      const req = MeetingDeleteRequestSchema.parse(raw)
      deps.history?.delete(req.meetingId)
      return MeetingDeleteResponseSchema.parse({ ok: true })
    },
  }
}
