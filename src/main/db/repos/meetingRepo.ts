/**
 * Repository for Meeting entities.
 *
 * Row → domain mapping goes through MeetingSchema (Zod), so corrupt rows
 * throw on read rather than silently returning invalid data.
 */
import type Database from 'better-sqlite3'

import { MeetingSchema } from '@shared/domain'
import type { Meeting } from '@shared/domain'

interface MeetingRow {
  id: string
  title: string
  state: string
  created_at: string
  updated_at: string | null
  ended_at: string | null
  primary_language: string
}

function rowToDomain(row: MeetingRow): Meeting {
  return MeetingSchema.parse({
    id: row.id,
    title: row.title,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    primaryLanguage: row.primary_language,
  })
}

export function meetingRepo(db: Database.Database) {
  return {
    insert(m: Meeting): void {
      db.prepare(
        `INSERT INTO meetings (id, title, state, created_at, updated_at, ended_at, primary_language)
         VALUES (@id, @title, @state, @createdAt, @updatedAt, @endedAt, @primaryLanguage)`,
      ).run({
        id: m.id,
        title: m.title,
        state: m.state,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt ?? null,
        endedAt: m.endedAt ?? null,
        primaryLanguage: m.primaryLanguage,
      })
    },

    update(m: Meeting): void {
      db.prepare(
        `UPDATE meetings
         SET title = @title, state = @state, updated_at = @updatedAt,
             ended_at = @endedAt, primary_language = @primaryLanguage
         WHERE id = @id`,
      ).run({
        id: m.id,
        title: m.title,
        state: m.state,
        updatedAt: m.updatedAt ?? null,
        endedAt: m.endedAt ?? null,
        primaryLanguage: m.primaryLanguage,
      })
    },

    findById(id: string): Meeting | null {
      const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
        | MeetingRow
        | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    list(): Meeting[] {
      const rows = db
        .prepare('SELECT * FROM meetings ORDER BY created_at DESC')
        .all() as MeetingRow[]
      return rows.map(rowToDomain)
    },

    delete(id: string): void {
      db.prepare('DELETE FROM meetings WHERE id = ?').run(id)
    },
  }
}
