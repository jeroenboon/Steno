import type Database from 'better-sqlite3'

import { AgendaItemSchema } from '@shared/domain'
import type { AgendaItem } from '@shared/domain'

import { parseRow } from '../mapRow'

export function agendaItemRepo(db: Database.Database) {
  return {
    insert(item: AgendaItem, meetingId: string): void {
      db.prepare(
        `INSERT INTO agenda_items (id, meeting_id, title, topic, state) VALUES (@id, @meetingId, @title, @topic, @state)`,
      ).run({ id: item.id, meetingId, title: item.title, topic: item.topic, state: item.state })
    },

    update(item: AgendaItem): void {
      db.prepare(
        `UPDATE agenda_items SET title = @title, topic = @topic, state = @state WHERE id = @id`,
      ).run({ id: item.id, title: item.title, topic: item.topic, state: item.state })
    },

    findById(id: string): AgendaItem | null {
      const row = db.prepare('SELECT * FROM agenda_items WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined
      if (row === undefined) return null
      return parseRow(row, AgendaItemSchema)
    },

    listByMeeting(meetingId: string): AgendaItem[] {
      const rows = db
        .prepare('SELECT * FROM agenda_items WHERE meeting_id = ?')
        .all(meetingId) as Record<string, unknown>[]
      return rows.map((row) => parseRow(row, AgendaItemSchema))
    },

    delete(id: string): void {
      db.prepare('DELETE FROM agenda_items WHERE id = ?').run(id)
    },
  }
}
