import type Database from 'better-sqlite3'

import { AgendaItemSchema } from '@shared/domain'
import type { AgendaItem } from '@shared/domain'

interface AgendaItemRow {
  id: string
  meeting_id: string
  title: string
  topic: string
}

function rowToDomain(row: AgendaItemRow): AgendaItem {
  return AgendaItemSchema.parse({
    id: row.id,
    title: row.title,
    topic: row.topic,
  })
}

export function agendaItemRepo(db: Database.Database) {
  return {
    insert(item: AgendaItem, meetingId: string): void {
      db.prepare(
        `INSERT INTO agenda_items (id, meeting_id, title, topic) VALUES (@id, @meetingId, @title, @topic)`,
      ).run({ id: item.id, meetingId, title: item.title, topic: item.topic })
    },

    findById(id: string): AgendaItem | null {
      const row = db.prepare('SELECT * FROM agenda_items WHERE id = ?').get(id) as
        | AgendaItemRow
        | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    listByMeeting(meetingId: string): AgendaItem[] {
      const rows = db
        .prepare('SELECT * FROM agenda_items WHERE meeting_id = ?')
        .all(meetingId) as AgendaItemRow[]
      return rows.map(rowToDomain)
    },

    delete(id: string): void {
      db.prepare('DELETE FROM agenda_items WHERE id = ?').run(id)
    },
  }
}
