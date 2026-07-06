/**
 * @vitest-environment node
 */
import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'

import { closeDatabase } from './database'

function openDb(): Database.Database {
  return new Database(':memory:')
}

describe('closeDatabase', () => {
  it('closes an open handle', () => {
    const db = openDb()
    expect(db.open).toBe(true)

    closeDatabase(db)

    expect(db.open).toBe(false)
  })

  it('is idempotent — safe to call twice without throwing', () => {
    const db = openDb()

    closeDatabase(db)
    expect(() => {
      closeDatabase(db)
    }).not.toThrow()
    expect(db.open).toBe(false)
  })

  it('is a no-op when the handle is already closed', () => {
    const db = openDb()
    db.close()

    let closeCalled = false
    const spy = {
      get open(): boolean {
        return db.open
      },
      close(): Database.Database {
        closeCalled = true
        return db
      },
    }

    closeDatabase(spy)

    expect(closeCalled).toBe(false)
  })

  it('swallows a close() error and reports it via onError instead of throwing', () => {
    const failing = {
      open: true,
      close(): never {
        throw new Error('database is locked')
      },
    }

    let reported: unknown
    expect(() => {
      closeDatabase(failing, (err) => {
        reported = err
      })
    }).not.toThrow()
    expect(reported).toBeInstanceOf(Error)
    expect((reported as Error).message).toBe('database is locked')
  })
})
