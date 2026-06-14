import type Database from 'better-sqlite3'

import { DiscussionSummarySchema } from '@shared/domain'
import type { DiscussionSummary } from '@shared/domain'

interface DiscussionSummaryRow {
  id: string
  meeting_id: string
  agenda_item_id: string
  text: string
}

function rowToDomain(row: DiscussionSummaryRow): DiscussionSummary {
  return DiscussionSummarySchema.parse({
    id: row.id,
    agendaItemId: row.agenda_item_id,
    text: row.text,
  })
}

export function discussionSummaryRepo(db: Database.Database) {
  return {
    insert(s: DiscussionSummary, meetingId: string): void {
      db.prepare(
        `INSERT INTO discussion_summaries (id, meeting_id, agenda_item_id, text)
         VALUES (@id, @meetingId, @agendaItemId, @text)`,
      ).run({ id: s.id, meetingId, agendaItemId: s.agendaItemId, text: s.text })
    },

    update(s: DiscussionSummary): void {
      db.prepare(
        `UPDATE discussion_summaries SET agenda_item_id = @agendaItemId, text = @text WHERE id = @id`,
      ).run({ id: s.id, agendaItemId: s.agendaItemId, text: s.text })
    },

    findById(id: string): DiscussionSummary | null {
      const row = db.prepare('SELECT * FROM discussion_summaries WHERE id = ?').get(id) as
        | DiscussionSummaryRow
        | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    listByMeeting(meetingId: string): DiscussionSummary[] {
      const rows = db
        .prepare('SELECT * FROM discussion_summaries WHERE meeting_id = ?')
        .all(meetingId) as DiscussionSummaryRow[]
      return rows.map(rowToDomain)
    },

    delete(id: string): void {
      db.prepare('DELETE FROM discussion_summaries WHERE id = ?').run(id)
    },
  }
}
