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
})
