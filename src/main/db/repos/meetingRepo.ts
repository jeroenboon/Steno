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
  source: string
  paused: number // SQLite stores booleans as 0/1
  created_at: string
  updated_at: string | null
  started_at: string | null
  ended_at: string | null
  primary_language: string
}

function rowToDomain(row: MeetingRow): Meeting {
  return MeetingSchema.parse({
    id: row.id,
    title: row.title,
    state: row.state,
    source: row.source,
    paused: row.paused === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    primaryLanguage: row.primary_language,
  })
}

export function meetingRepo(db: Database.Database) {
  return {
    insert(m: Meeting): void {
      db.prepare(
        `INSERT INTO meetings (id, title, state, source, paused, created_at, updated_at, started_at, ended_at, primary_language)
         VALUES (@id, @title, @state, @source, @paused, @createdAt, @updatedAt, @startedAt, @endedAt, @primaryLanguage)`,
      ).run({
        id: m.id,
        title: m.title,
        state: m.state,
        source: m.source,
        paused: m.paused ? 1 : 0,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt ?? null,
        startedAt: m.startedAt ?? null,
        endedAt: m.endedAt ?? null,
        primaryLanguage: m.primaryLanguage,
      })
    },

    update(m: Meeting): void {
      db.prepare(
        `UPDATE meetings
         SET title = @title, state = @state, paused = @paused,
             updated_at = @updatedAt, started_at = @startedAt,
             ended_at = @endedAt, primary_language = @primaryLanguage
         WHERE id = @id`,
      ).run({
        id: m.id,
        title: m.title,
        state: m.state,
        paused: m.paused ? 1 : 0,
        updatedAt: m.updatedAt ?? null,
        startedAt: m.startedAt ?? null,
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
