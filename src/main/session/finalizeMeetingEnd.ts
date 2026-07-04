/**
 * finalizeMeetingEnd — the single "transition Live -> Ended, once" step both
 * session controllers run after the final extraction pass (review item 5).
 *
 * The final pass may enrich the meeting row (inferred agenda, rewritten title),
 * so the transition runs last. Only a still-Live row transitions, through the
 * single enforcer (MeetingLifecycleService), which sets `endedAt` and guards a
 * double-end. An already-Ended or missing row is a no-op.
 */

import type { meetingRepo } from '../db/repos/meetingRepo'
import type { MeetingLifecycleService } from '../services/meetingLifecycleService'

export function finalizeMeetingEnd(
  meetings: ReturnType<typeof meetingRepo>,
  lifecycle: MeetingLifecycleService,
  meetingId: string,
): void {
  if (meetings.findById(meetingId)?.state === 'live') {
    lifecycle.endMeeting(meetingId)
  }
}
