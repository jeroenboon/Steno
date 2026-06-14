/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Meeting, TranscriptSpan, Decision } from '@shared/domain'

import { runMigrations } from '../migrate'

import { decisionRepo } from './decisionRepo'
import { meetingRepo } from './meetingRepo'
import { transcriptSpanRepo } from './transcriptSpanRepo'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const meeting: Meeting = {
  id: 'mtg-1',
  title: 'Test',
  state: 'draft',
  createdAt: '2026-06-14T10:00:00.000Z',
  primaryLanguage: 'nl',
}

const span: TranscriptSpan = {
  id: 'span-1',
  text: 'We go with TypeScript',
  startMs: 0,
  endMs: 1000,
}

const decision: Decision = {
  id: 'dec-1',
  rationale: 'We go with TypeScript',
  agendaItemId: 'ai-1',
  sourceSpanId: 'span-1',
  state: 'proposed',
}

describe('decisionRepo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb()
    meetingRepo(db).insert(meeting)
    transcriptSpanRepo(db).insert(span, 'mtg-1')
  })

  it('inserts and retrieves a decision by id', () => {
    const repo = decisionRepo(db)
    repo.insert(decision, 'mtg-1')
    const found = repo.findById('dec-1')
    expect(found?.rationale).toBe('We go with TypeScript')
    expect(found?.state).toBe('proposed')
    expect(found?.agendaItemId).toBe('ai-1')
  })

  it('lists decisions for a meeting', () => {
    const repo = decisionRepo(db)
    repo.insert(decision, 'mtg-1')
    repo.insert(
      {
        id: 'dec-2',
        rationale: 'No dark mode yet',
        agendaItemId: 'ai-1',
        sourceSpanId: 'span-1',
        state: 'confirmed',
      },
      'mtg-1',
    )
    expect(repo.listByMeeting('mtg-1')).toHaveLength(2)
  })

  it('updates a decision', () => {
    const repo = decisionRepo(db)
    repo.insert(decision, 'mtg-1')
    repo.update({ ...decision, state: 'confirmed' })
    const found = repo.findById('dec-1')
    expect(found?.state).toBe('confirmed')
  })

  it('cascades delete when meeting is deleted', () => {
    const repo = decisionRepo(db)
    repo.insert(decision, 'mtg-1')
    meetingRepo(db).delete('mtg-1')
    expect(repo.findById('dec-1')).toBeNull()
  })
})
