/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Meeting } from '@shared/domain'

import { runMigrations } from '../migrate'

import { meetingRepo } from './meetingRepo'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const sample: Meeting = {
  id: 'mtg-1',
  title: 'Q3 Planning',
  state: 'draft',
  source: 'live',
  paused: false,
  createdAt: '2026-06-14T10:00:00.000Z',
  primaryLanguage: 'nl',
}

describe('meetingRepo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb()
  })

  it('inserts and retrieves a meeting by id', () => {
    const repo = meetingRepo(db)
    repo.insert(sample)
    const found = repo.findById('mtg-1')
    expect(found).not.toBeNull()
    expect(found?.id).toBe('mtg-1')
    expect(found?.title).toBe('Q3 Planning')
    expect(found?.state).toBe('draft')
    expect(found?.primaryLanguage).toBe('nl')
  })

  it('round-trips an imported meeting source', () => {
    const repo = meetingRepo(db)
    repo.insert({ ...sample, id: 'mtg-import', source: 'import' })
    expect(repo.findById('mtg-import')?.source).toBe('import')
  })

  it('defaults source to live for rows written before the source column', () => {
    const repo = meetingRepo(db)
    // Simulate a legacy row written without the source column; the migration's
    // column DEFAULT 'live' supplies the value.
    db.prepare(
      `INSERT INTO meetings (id, title, state, paused, created_at, primary_language)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('legacy', 'Legacy', 'ended', 0, '2026-06-14T10:00:00.000Z', 'nl')
    expect(repo.findById('legacy')?.source).toBe('live')
  })

  it('returns null for unknown id', () => {
    const repo = meetingRepo(db)
    expect(repo.findById('no-such-id')).toBeNull()
  })

  it('lists all meetings', () => {
    const repo = meetingRepo(db)
    repo.insert(sample)
    repo.insert({ ...sample, id: 'mtg-2', title: 'Kickoff' })
    const all = repo.list()
    expect(all).toHaveLength(2)
  })

  it('updates a meeting', () => {
    const repo = meetingRepo(db)
    repo.insert(sample)
    repo.update({ ...sample, state: 'live', updatedAt: '2026-06-14T11:00:00.000Z' })
    const found = repo.findById('mtg-1')
    expect(found?.state).toBe('live')
    expect(found?.updatedAt).toBe('2026-06-14T11:00:00.000Z')
  })

  it('rejects a corrupt row via Zod (missing title column simulated)', () => {
    const repo = meetingRepo(db)
    // Insert raw invalid data bypassing the repo to simulate DB corruption
    db.prepare(
      `INSERT INTO meetings (id, title, state, created_at, primary_language)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('bad-row', '', 'draft', '2026-06-14T10:00:00.000Z', 'nl')
    expect(() => repo.findById('bad-row')).toThrow()
  })

  it('deletes a meeting and all its child rows (agenda, participants, spans, items, summaries)', () => {
    const repo = meetingRepo(db)
    repo.insert({ ...sample, id: 'mtg-del' })

    // Seed every child table, including a decision + action that reference a span
    // via ON DELETE RESTRICT (the case a naive meeting delete would trip over).
    db.prepare(`INSERT INTO agenda_items (id, meeting_id, title, topic) VALUES (?, ?, ?, ?)`).run(
      'ai-1',
      'mtg-del',
      'Planning',
      'Q3',
    )
    db.prepare(`INSERT INTO participants (id, meeting_id, name) VALUES (?, ?, ?)`).run(
      'p-1',
      'mtg-del',
      'Jeroen',
    )
    db.prepare(
      `INSERT INTO transcript_spans (id, meeting_id, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)`,
    ).run('span-1', 'mtg-del', 'Hallo', 0, 1000)
    db.prepare(
      `INSERT INTO decisions (id, meeting_id, rationale, agenda_item_id, source_span_id, state)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('d-1', 'mtg-del', 'Besloten', 'ai-1', 'span-1', 'confirmed')
    db.prepare(
      `INSERT INTO actions (id, meeting_id, agenda_item_id, source_span_id, status, state)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('a-1', 'mtg-del', 'ai-1', 'span-1', 'open', 'confirmed')
    db.prepare(
      `INSERT INTO discussion_summaries (id, meeting_id, agenda_item_id, text) VALUES (?, ?, ?, ?)`,
    ).run('ds-1', 'mtg-del', 'ai-1', 'Besproken')

    repo.delete('mtg-del')

    expect(repo.findById('mtg-del')).toBeNull()
    const count = (table: string): number =>
      (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE meeting_id = ?`).get('mtg-del') as {
          n: number
        }
      ).n
    for (const table of [
      'agenda_items',
      'participants',
      'transcript_spans',
      'decisions',
      'actions',
      'discussion_summaries',
    ]) {
      expect(count(table)).toBe(0)
    }
  })
})
