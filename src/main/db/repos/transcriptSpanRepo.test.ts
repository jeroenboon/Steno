/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Meeting, TranscriptSpan } from '@shared/domain'

import { runMigrations } from '../migrate'

import { meetingRepo } from './meetingRepo'
import { transcriptSpanRepo } from './transcriptSpanRepo'

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
  source: 'live',
  paused: false,
  createdAt: '2026-06-14T10:00:00.000Z',
  primaryLanguage: 'nl',
}

const sampleSpan: TranscriptSpan = {
  id: 'span-1',
  text: 'Jeroen stuurt het deck',
  startMs: 1000,
  endMs: 2500,
  confidence: 0.97,
}

describe('transcriptSpanRepo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb()
    meetingRepo(db).insert(sampleMeeting)
  })

  it('inserts and retrieves a span by id', () => {
    const repo = transcriptSpanRepo(db)
    repo.insert(sampleSpan, 'mtg-1')
    const found = repo.findById('span-1')
    expect(found?.text).toBe('Jeroen stuurt het deck')
    expect(found?.startMs).toBe(1000)
    expect(found?.confidence).toBe(0.97)
  })

  it('allows optional fields to be absent', () => {
    const repo = transcriptSpanRepo(db)
    const spanNoOpts: TranscriptSpan = { id: 'span-2', text: 'Hello', startMs: 0, endMs: 500 }
    repo.insert(spanNoOpts, 'mtg-1')
    const found = repo.findById('span-2')
    expect(found?.confidence).toBeUndefined()
    expect(found?.speakerLabel).toBeUndefined()
  })

  it('lists spans for a meeting in order', () => {
    const repo = transcriptSpanRepo(db)
    repo.insert(sampleSpan, 'mtg-1')
    repo.insert({ id: 'span-2', text: 'Dan we further', startMs: 3000, endMs: 4000 }, 'mtg-1')
    const spans = repo.listByMeeting('mtg-1')
    expect(spans).toHaveLength(2)
    expect(spans[0]?.startMs).toBeLessThanOrEqual(spans[1]?.startMs ?? Infinity)
  })

  it('cascades delete when meeting is deleted', () => {
    const repo = transcriptSpanRepo(db)
    repo.insert(sampleSpan, 'mtg-1')
    meetingRepo(db).delete('mtg-1')
    expect(repo.findById('span-1')).toBeNull()
  })
})
