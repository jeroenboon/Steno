import type Database from 'better-sqlite3'

import { ParticipantSchema } from '@shared/domain'
import type { Participant } from '@shared/domain'

import { parseRow } from '../mapRow'

export function participantRepo(db: Database.Database) {
  return {
    insert(p: Participant, meetingId: string): void {
      db.prepare(
        `INSERT INTO participants (id, meeting_id, name) VALUES (@id, @meetingId, @name)`,
      ).run({ id: p.id, meetingId, name: p.name })
    },

    findById(id: string): Participant | null {
      const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as
        Record<string, unknown> | undefined
      if (row === undefined) return null
      return parseRow(row, ParticipantSchema)
    },

    listByMeeting(meetingId: string): Participant[] {
      const rows = db
        .prepare('SELECT * FROM participants WHERE meeting_id = ?')
        .all(meetingId) as Record<string, unknown>[]
      return rows.map((row) => parseRow(row, ParticipantSchema))
    },

    delete(id: string): void {
      db.prepare('DELETE FROM participants WHERE id = ?').run(id)
    },
  }
}
