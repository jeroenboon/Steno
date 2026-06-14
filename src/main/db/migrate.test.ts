/**
 * @vitest-environment node
 *
 * Migration runner tests.
 * Uses :memory: DB so no filesystem side-effects.
 */
import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'

import { runMigrations } from './migrate'

function openMemory(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('runMigrations', () => {
  it('creates the schema_migrations table', () => {
    const db = openMemory()
    runMigrations(db)

    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
      .get()

    expect(row).toBeDefined()
  })

  it('is idempotent — running twice produces no error and same schema', () => {
    const db = openMemory()
    runMigrations(db)
    expect(() => {
      runMigrations(db)
    }).not.toThrow()

    // Still exactly one entry in schema_migrations after double-run
    const count = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    expect(count.n).toBe(1) // migration 0001 applied once
  })

  it('creates all required tables', () => {
    const db = openMemory()
    runMigrations(db)

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)

    expect(names).toContain('meetings')
    expect(names).toContain('agenda_items')
    expect(names).toContain('participants')
    expect(names).toContain('decisions')
    expect(names).toContain('actions')
    expect(names).toContain('transcript_spans')
    expect(names).toContain('discussion_summaries')
  })
})
