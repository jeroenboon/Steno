/**
 * Session IPC handlers (audit A2b): audio:start/stop, meeting:end/pause/resume,
 * summary:query. Owns the SessionOps port, satisfied by LiveSessionController.
 */

import type { Meeting } from '@shared/domain'
import {
  AudioStartRequestSchema,
  AudioStartResponseSchema,
  AudioStopRequestSchema,
  AudioStopResponseSchema,
  MeetingEndRequestSchema,
  MeetingEndResponseSchema,
  MeetingPauseRequestSchema,
  MeetingPauseResponseSchema,
  MeetingResumeRequestSchema,
  MeetingResumeResponseSchema,
  SummaryQueryRequestSchema,
  SummaryQueryResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  AudioStartResponse,
  AudioStopResponse,
  MeetingEndResponse,
  MeetingPauseResponse,
  MeetingResumeResponse,
  SummaryQueryResponse,
} from '@shared/ipc'

import type { Handler } from './handlerTypes'

/** Live-session lifecycle. Satisfied by LiveSessionController. */
export interface SessionOps {
  /** Spin up the LiveExtractionRuntime for the active session (audio:start). */
  start(meetingId: string): void
  /** Tear down the active session (audio:stop). */
  stop(): void
  /** Run the final pass, emit items:summaries, transition Live → Ended (meeting:end). */
  endMeeting(meetingId: string): Promise<void>
  /** Pause the live meeting; returns the updated Meeting (meeting:pause). */
  pause(meetingId: string): Meeting
  /** Resume the live meeting; returns the updated Meeting (meeting:resume). */
  resume(meetingId: string): Meeting
  /** Answer a free-form question grounded in the active transcript (summary:query). */
  querySummary(question: string): Promise<string>
}

export interface SessionHandlerDeps {
  session?: SessionOps
}

export function createSessionHandlers(
  deps: SessionHandlerDeps,
): Partial<Record<IpcChannel, Handler>> {
  return {
    'audio:start': (raw: unknown): AudioStartResponse => {
      const req = AudioStartRequestSchema.parse(raw)
      deps.session?.start(req.meetingId)
      return AudioStartResponseSchema.parse({ ok: true })
    },
    'audio:stop': (raw: unknown): AudioStopResponse => {
      AudioStopRequestSchema.parse(raw)
      deps.session?.stop()
      return AudioStopResponseSchema.parse({ ok: true })
    },
    'summary:query': async (raw: unknown): Promise<SummaryQueryResponse> => {
      const req = SummaryQueryRequestSchema.parse(raw)
      const answer = deps.session !== undefined ? await deps.session.querySummary(req.question) : ''
      return SummaryQueryResponseSchema.parse({ answer })
    },
    'meeting:end': async (raw: unknown): Promise<MeetingEndResponse> => {
      const req = MeetingEndRequestSchema.parse(raw)
      if (deps.session !== undefined) {
        await deps.session.endMeeting(req.meetingId)
      }
      return MeetingEndResponseSchema.parse({ ok: true })
    },
    'meeting:pause': (raw: unknown): MeetingPauseResponse => {
      const req = MeetingPauseRequestSchema.parse(raw)
      if (deps.session === undefined) {
        throw new Error('meeting:pause is not available')
      }
      return MeetingPauseResponseSchema.parse(deps.session.pause(req.meetingId))
    },
    'meeting:resume': (raw: unknown): MeetingResumeResponse => {
      const req = MeetingResumeRequestSchema.parse(raw)
      if (deps.session === undefined) {
        throw new Error('meeting:resume is not available')
      }
      return MeetingResumeResponseSchema.parse(deps.session.resume(req.meetingId))
    },
  }
}
