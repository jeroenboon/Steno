import type Database from 'better-sqlite3'

import { ActionSchema } from '@shared/domain'
import type { Action } from '@shared/domain'

interface ActionRow {
  id: string
  meeting_id: string
  agenda_item_id: string
  source_span_id: string
  owner: string | null
  due_date: string | null
  status: string
  state: string
}

function rowToDomain(row: ActionRow): Action {
  return ActionSchema.parse({
    id: row.id,
    agendaItemId: row.agenda_item_id,
    sourceSpanId: row.source_span_id,
    owner: row.owner ?? undefined,
    dueDate: row.due_date ?? undefined,
    status: row.status,
    state: row.state,
  })
}

export function actionRepo(db: Database.Database) {
  return {
    insert(a: Action, meetingId: string): void {
      db.prepare(
        `INSERT INTO actions (id, meeting_id, agenda_item_id, source_span_id, owner, due_date, status, state)
         VALUES (@id, @meetingId, @agendaItemId, @sourceSpanId, @owner, @dueDate, @status, @state)`,
      ).run({
        id: a.id,
        meetingId,
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
         SET agenda_item_id = @agendaItemId, source_span_id = @sourceSpanId,
             owner = @owner, due_date = @dueDate, status = @status, state = @state
         WHERE id = @id`,
      ).run({
        id: a.id,
        agendaItemId: a.agendaItemId,
        sourceSpanId: a.sourceSpanId,
        owner: a.owner ?? null,
        dueDate: a.dueDate ?? null,
        status: a.status,
        state: a.state,
      })
    },

    findById(id: string): Action | null {
      const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    listActionsByMeeting(meetingId: string): Action[] {
      const rows = db
        .prepare('SELECT * FROM actions WHERE meeting_id = ?')
        .all(meetingId) as ActionRow[]
      return rows.map(rowToDomain)
    },

    /**
     * Cross-meeting query: returns all open actions for a given owner.
     * Used for Phase 3 dashboards; proves the schema supports it from day one.
     */
    listOpenActionsByOwner(ownerId: string): Action[] {
      const rows = db
        .prepare(`SELECT * FROM actions WHERE owner = ? AND status = 'open'`)
        .all(ownerId) as ActionRow[]
      return rows.map(rowToDomain)
    },

    delete(id: string): void {
      db.prepare('DELETE FROM actions WHERE id = ?').run(id)
    },
  }
}
