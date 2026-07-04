import type Database from 'better-sqlite3'

import { ActionSchema } from '@shared/domain'
import type { Action } from '@shared/domain'

import { parseRow } from '../mapRow'

export function actionRepo(db: Database.Database) {
  return {
    insert(a: Action, meetingId: string): void {
      db.prepare(
        `INSERT INTO actions (id, meeting_id, description, agenda_item_id, source_span_id, owner, due_date, status, state)
         VALUES (@id, @meetingId, @description, @agendaItemId, @sourceSpanId, @owner, @dueDate, @status, @state)`,
      ).run({
        id: a.id,
        meetingId,
        description: a.description ?? null,
        agendaItemId: a.agendaItemId,
        sourceSpanId: a.sourceSpanId,
        owner: a.owner ?? null,
        dueDate: a.dueDate ?? null,
        status: a.status,
        state: a.state,
      })
    },

    update(a: Action): void {
      db.prepare(
        `UPDATE actions
         SET description = @description, agenda_item_id = @agendaItemId, source_span_id = @sourceSpanId,
             owner = @owner, due_date = @dueDate, status = @status, state = @state
         WHERE id = @id`,
      ).run({
        id: a.id,
        description: a.description ?? null,
        agendaItemId: a.agendaItemId,
        sourceSpanId: a.sourceSpanId,
        owner: a.owner ?? null,
        dueDate: a.dueDate ?? null,
        status: a.status,
        state: a.state,
      })
    },

    findById(id: string): Action | null {
      const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined
      if (row === undefined) return null
      return parseRow(row, ActionSchema)
    },

    listByMeeting(meetingId: string): Action[] {
      const rows = db
        .prepare('SELECT * FROM actions WHERE meeting_id = ?')
        .all(meetingId) as Record<string, unknown>[]
      return rows.map((row) => parseRow(row, ActionSchema))
    },

    /**
     * Cross-meeting query: returns all open actions for a given owner.
     * Used for Phase 3 dashboards; proves the schema supports it from day one.
     */
    listOpenActionsByOwner(ownerId: string): Action[] {
      const rows = db
        .prepare(`SELECT * FROM actions WHERE owner = ? AND status = 'open'`)
        .all(ownerId) as Record<string, unknown>[]
      return rows.map((row) => parseRow(row, ActionSchema))
    },

    /** Resolve the meeting an action belongs to, or null when unknown. */
    findMeetingId(id: string): string | null {
      const row = db.prepare('SELECT meeting_id FROM actions WHERE id = ?').get(id) as
        | { meeting_id: string }
        | undefined
      return row?.meeting_id ?? null
    },

    delete(id: string): void {
      db.prepare('DELETE FROM actions WHERE id = ?').run(id)
    },
  }
}
