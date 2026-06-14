/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Meeting, DiscussionSummary } from '@shared/domain'

import { runMigrations } from '../migrate'

import { discussionSummaryRepo } from './discussionSummaryRepo'
import { meetingRepo } from './meetingRepo'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const meeting: Meeting = {
  id: 'mtg-1',
  title: 'Test',
  state: 'ended',
  paused: false,
  createdAt: '2026-06-14T10:00:00.000Z',
  primaryLanguage: 'nl',
}

const summary: DiscussionSummary = {
  id: 'ds-1',
  agendaItemId: 'ai-1',
  text: 'We discussed Q3 performance and agreed targets are on track.',
}

describe('discussionSummaryRepo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb()
    meetingRepo(db).insert(meeting)
  })

  it('inserts and retrieves a discussion summary by id', () => {
    const repo = discussionSummaryRepo(db)
    repo.insert(summary, 'mtg-1')
    const found = repo.findById('ds-1')
    expect(found?.text).toBe('We discussed Q3 performance and agreed targets are on track.')
    expect(found?.agendaItemId).toBe('ai-1')
  })

  it('lists summaries for a meeting', () => {
    const repo = discussionSummaryRepo(db)
    repo.insert(summary, 'mtg-1')
    repo.insert({ id: 'ds-2', agendaItemId: 'ai-2', text: 'Off-agenda items were minor.' }, 'mtg-1')
    expect(repo.listByMeeting('mtg-1')).toHaveLength(2)
  })

  it('updates a summary', () => {
    const repo = discussionSummaryRepo(db)
    repo.insert(summary, 'mtg-1')
    repo.update({ ...summary, text: 'Revised summary.' })
    const found = repo.findById('ds-1')
    expect(found?.text).toBe('Revised summary.')
  })

  it('cascades delete when meeting is deleted', () => {
    const repo = discussionSummaryRepo(db)
    repo.insert(summary, 'mtg-1')
    meetingRepo(db).delete('mtg-1')
    expect(repo.findById('ds-1')).toBeNull()
  })
})
