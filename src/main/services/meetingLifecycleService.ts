/**
 * MeetingLifecycleService (item 0006).
 *
 * Enforces the meeting state machine:
 *   Draft → Live → Ended
 *
 * Pause/resume are sub-states within Live. They do NOT create a new meeting or
 * transcript — the same transcript continues after resume. Ended is terminal
 * for the lifecycle (items remain editable — that's the item lifecycle
 * service's concern, not ours).
 *
 * This is the single enforcer of the transitions: the session controllers route
 * Draft → Live and Live → Ended through it, and the IPC layer routes
 * pause/resume through it. The final extraction pass runs via a direct call from
 * the controller (LiveSessionController.endMeeting), not a subscription.
 */

import type { Meeting, MeetingId } from '@shared/domain'
import type { Clock } from '@shared/providers'

import type { meetingRepo } from '../db/repos/meetingRepo'

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MeetingLifecycleService {
  private readonly repo: ReturnType<typeof meetingRepo>
  private readonly clock: Clock

  constructor(repo: ReturnType<typeof meetingRepo>, clock: Clock) {
    this.repo = repo
    this.clock = clock
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  /**
   * Draft → Live.
   * Sets startedAt from the injected clock.
   */
  startMeeting(meetingId: MeetingId): Meeting {
    const meeting = this.load(meetingId)

    if (meeting.state !== 'draft') {
      throw new Error(
        `Cannot start meeting "${meetingId}": meeting is in state "${meeting.state}", expected "draft".`,
      )
    }

    const now = new Date(this.clock.now()).toISOString()
    const updated: Meeting = {
      ...meeting,
      state: 'live',
      paused: false,
      startedAt: now,
      updatedAt: now,
    }

    this.repo.update(updated)
    return updated
  }

  /**
   * Mark a Live meeting as paused (sub-state within Live).
   * The state remains "live" — pause is not a fourth top-level state.
   * No new meeting or transcript is created.
   */
  pauseMeeting(meetingId: MeetingId): Meeting {
    const meeting = this.load(meetingId)

    if (meeting.state !== 'live') {
      throw new Error(
        `Cannot pause meeting "${meetingId}": meeting is in state "${meeting.state}", expected "live".`,
      )
    }

    if (meeting.paused) {
      throw new Error(`Cannot pause meeting "${meetingId}": meeting is already paused.`)
    }

    const now = new Date(this.clock.now()).toISOString()
    const updated: Meeting = {
      ...meeting,
      paused: true,
      updatedAt: now,
    }

    this.repo.update(updated)
    return updated
  }

  /**
   * Resume a paused Live meeting.
   * Clears the paused flag; the same transcript continues.
   */
  resumeMeeting(meetingId: MeetingId): Meeting {
    const meeting = this.load(meetingId)

    if (!meeting.paused || meeting.state !== 'live') {
      throw new Error(
        `Cannot resume meeting "${meetingId}": meeting is not paused (state="${meeting.state}", paused=${String(meeting.paused)}).`,
      )
    }

    const now = new Date(this.clock.now()).toISOString()
    const updated: Meeting = {
      ...meeting,
      paused: false,
      updatedAt: now,
    }

    this.repo.update(updated)
    return updated
  }

  /**
   * Live → Ended (terminal).
   * Works whether the meeting is paused or not.
   * Sets endedAt from the injected clock.
   */
  endMeeting(meetingId: MeetingId): Meeting {
    const meeting = this.load(meetingId)

    if (meeting.state !== 'live') {
      throw new Error(
        `Cannot end meeting "${meetingId}": meeting is in state "${meeting.state}", expected "live".`,
      )
    }

    const now = new Date(this.clock.now()).toISOString()
    const updated: Meeting = {
      ...meeting,
      state: 'ended',
      paused: false,
      endedAt: now,
      updatedAt: now,
    }

    this.repo.update(updated)
    return updated
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private load(meetingId: MeetingId): Meeting {
    const meeting = this.repo.findById(meetingId)
    if (meeting === null) {
      throw new Error(`Meeting not found: "${meetingId}".`)
    }
    return meeting
  }
}
