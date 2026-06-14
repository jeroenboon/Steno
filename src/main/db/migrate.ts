/**
 * Forward-only migration runner.
 *
 * Reads numbered SQL files from ./migrations/, tracks which have been applied
 * in the schema_migrations table, and applies missing ones in order inside a
 * single transaction. Running twice is a no-op.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database): void {
  // Ensure the migrations table exists first (outside the main transaction so
  // we can query it to decide what to run).
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const migrationsDir = join(__dirname, 'migrations')

  // Discover migration files: must match NNNN_*.sql, sorted ascending.
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()

  // Which versions are already applied?
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  )

  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) return

  // Apply all pending migrations inside a single transaction for atomicity.
  db.transaction(() => {
    for (const file of pending) {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8')
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      )
    }
  })()
}
