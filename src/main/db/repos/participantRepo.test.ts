/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Meeting, Participant } from '@shared/domain'

import { runMigrations } from '../migrate'

import { meetingRepo } from './meetingRepo'
import { participantRepo } from './participantRepo'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const sampleMeeting: Meeting = {
  id: 'mtg-1',
  title: 'Test',
  state: 'draft',
  paused: false,
  createdAt: '2026-06-14T10:00:00.000Z',
  primaryLanguage: 'nl',
}

describe('participantRepo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb()
    meetingRepo(db).insert(sampleMeeting)
  })

  it('inserts and retrieves a participant by id', () => {
    const repo = participantRepo(db)
    const p: Participant = { id: 'p-1', name: 'Jeroen' }
    repo.insert(p, 'mtg-1')
    const found = repo.findById('p-1')
    expect(found?.name).toBe('Jeroen')
  })

  it('lists participants for a meeting', () => {
    const repo = participantRepo(db)
    repo.insert({ id: 'p-1', name: 'Jeroen' }, 'mtg-1')
    repo.insert({ id: 'p-2', name: 'Anika' }, 'mtg-1')
    const list = repo.listByMeeting('mtg-1')
    expect(list).toHaveLength(2)
  })

  it('cascades delete when meeting is deleted', () => {
    const repo = participantRepo(db)
    repo.insert({ id: 'p-1', name: 'Jeroen' }, 'mtg-1')
    meetingRepo(db).delete('mtg-1')
    expect(repo.findById('p-1')).toBeNull()
  })
})
