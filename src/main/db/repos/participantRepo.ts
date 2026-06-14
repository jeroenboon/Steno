import type Database from 'better-sqlite3'

import { ParticipantSchema } from '@shared/domain'
import type { Participant } from '@shared/domain'

interface ParticipantRow {
  id: string
  meeting_id: string
  name: string
}

function rowToDomain(row: ParticipantRow): Participant {
  return ParticipantSchema.parse({ id: row.id, name: row.name })
}

export function participantRepo(db: Database.Database) {
  return {
    insert(p: Participant, meetingId: string): void {
      db.prepare(
        `INSERT INTO participants (id, meeting_id, name) VALUES (@id, @meetingId, @name)`,
      ).run({ id: p.id, meetingId, name: p.name })
    },

    findById(id: string): Participant | null {
      const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as
        | ParticipantRow
        | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    listByMeeting(meetingId: string): Participant[] {
      const rows = db
        .prepare('SELECT * FROM participants WHERE meeting_id = ?')
        .all(meetingId) as ParticipantRow[]
      return rows.map(rowToDomain)
    },

    delete(id: string): void {
      db.prepare('DELETE FROM participants WHERE id = ?').run(id)
    },
  }
}
