/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Meeting, AgendaItem } from '@shared/domain'

import { runMigrations } from '../migrate'

import { agendaItemRepo } from './agendaItemRepo'
import { meetingRepo } from './meetingRepo'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const sampleMeeting: Meeting = {
  id: 'mtg-1',
  title: 'Test meeting',
  state: 'draft',
  createdAt: '2026-06-14T10:00:00.000Z',
  primaryLanguage: 'nl',
}

const sampleItem: AgendaItem = {
  id: 'ai-1',
  title: 'Review results',
  topic: 'Q3 performance',
}

describe('agendaItemRepo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb()
    meetingRepo(db).insert(sampleMeeting)
  })

  it('inserts and retrieves an agenda item by id', () => {
    const repo = agendaItemRepo(db)
    repo.insert(sampleItem, 'mtg-1')
    const found = repo.findById('ai-1')
    expect(found).not.toBeNull()
    expect(found?.id).toBe('ai-1')
    expect(found?.title).toBe('Review results')
    expect(found?.topic).toBe('Q3 performance')
  })

  it('lists agenda items for a meeting', () => {
    const repo = agendaItemRepo(db)
    repo.insert(sampleItem, 'mtg-1')
    repo.insert({ id: 'ai-2', title: 'Risks', topic: 'Known risks' }, 'mtg-1')
    const items = repo.listByMeeting('mtg-1')
    expect(items).toHaveLength(2)
  })

  it('cascades delete when meeting is deleted', () => {
    const repo = agendaItemRepo(db)
    repo.insert(sampleItem, 'mtg-1')
    meetingRepo(db).delete('mtg-1')
    expect(repo.findById('ai-1')).toBeNull()
  })
})
