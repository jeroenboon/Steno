/**
 * MeetingQueryService — read-only queries over past meetings (item 6a of the
 * 2026-07 architecture review).
 *
 * These four calls (list / load / delete / transcript text) used to be
 * pass-through closures inside `registerIpcHandlers` in index.ts, where they
 * pulled in the repos alongside Electron and could not be unit tested. Grouping
 * them behind one small module with injected repos (no Electron) gives them
 * locality and a real test surface; index.ts is left wiring an object, not
 * re-implementing the queries.
 *
 * The IPC handlers keep any Electron-specific step (e.g. writing the transcript
 * text to the clipboard) — this service only produces the data.
 */

import type { Meeting } from '@shared/domain'
import { toTranscriptText } from '@shared/export/meetingExporter'
import type { MeetingLoadResponse } from '@shared/ipc'

import type { actionRepo } from '../db/repos/actionRepo'
import type { agendaItemRepo } from '../db/repos/agendaItemRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'
import type { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import type { meetingRepo } from '../db/repos/meetingRepo'
import type { participantRepo } from '../db/repos/participantRepo'
import type { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

export interface MeetingQueryServiceDeps {
  meetingRepo: ReturnType<typeof meetingRepo>
  decisionRepo: ReturnType<typeof decisionRepo>
  actionRepo: ReturnType<typeof actionRepo>
  agendaItemRepo: ReturnType<typeof agendaItemRepo>
  participantRepo: ReturnType<typeof participantRepo>
  discussionSummaryRepo: ReturnType<typeof discussionSummaryRepo>
  transcriptSpanRepo: ReturnType<typeof transcriptSpanRepo>
}

export class MeetingQueryService {
  private readonly _meetings: ReturnType<typeof meetingRepo>
  private readonly _decisions: ReturnType<typeof decisionRepo>
  private readonly _actions: ReturnType<typeof actionRepo>
  private readonly _agenda: ReturnType<typeof agendaItemRepo>
  private readonly _participants: ReturnType<typeof participantRepo>
  private readonly _summaries: ReturnType<typeof discussionSummaryRepo>
  private readonly _spans: ReturnType<typeof transcriptSpanRepo>

  constructor(deps: MeetingQueryServiceDeps) {
    this._meetings = deps.meetingRepo
    this._decisions = deps.decisionRepo
    this._actions = deps.actionRepo
    this._agenda = deps.agendaItemRepo
    this._participants = deps.participantRepo
    this._summaries = deps.discussionSummaryRepo
    this._spans = deps.transcriptSpanRepo
  }

  /** All meetings that have progressed past Draft (the review history list). */
  list(): Meeting[] {
    return this._meetings.list().filter((m) => m.state !== 'draft')
  }

  /**
   * Full state of one past meeting for the Review screen: the meeting plus all
   * its decisions, actions, agenda items, participants and discussion summaries.
   * Null when the meeting does not exist.
   */
  load(meetingId: string): MeetingLoadResponse | null {
    const meeting = this._meetings.findById(meetingId)
    if (meeting === null) return null
    return {
      meeting,
      decisions: this._decisions.listByMeeting(meetingId),
      actions: this._actions.listByMeeting(meetingId),
      agendaItems: this._agenda.listByMeeting(meetingId),
      participants: this._participants.listByMeeting(meetingId),
      summaries: this._summaries.listByMeeting(meetingId),
    }
  }

  /** Delete a meeting (its child rows cascade). */
  delete(meetingId: string): void {
    this._meetings.delete(meetingId)
  }

  /** Render the meeting's transcript spans as plain text (for copy/export). */
  transcriptText(meetingId: string): string {
    return toTranscriptText(this._spans.listByMeeting(meetingId))
  }
}
