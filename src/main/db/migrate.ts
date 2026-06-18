/// <reference types="vite/client" />
/**
 * Forward-only migration runner.
 *
 * Tracks which numbered SQL migrations have been applied in the
 * schema_migrations table and applies missing ones in order inside a single
 * transaction. Running twice is a no-op.
 *
 * The SQL is inlined into the bundle at build time via import.meta.glob rather
 * than read from disk at runtime. The main process is bundled by electron-vite
 * into out/main/index.js, so a readdir of `__dirname/migrations` points at a
 * directory that does not exist (the .sql files are not emitted there) — and an
 * asar-packaged build makes that worse. Inlining keeps the migrations with the
 * code in every context: electron-vite dev/build, Vitest, and packaged.
 */
import type Database from 'better-sqlite3'

// Eagerly inline every migration's SQL as a raw string, keyed by its path
// (e.g. './migrations/0001_initial.sql'). Resolved by Vite (electron-vite for
// the app, Vitest for tests).
const migrationModules = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

interface Migration {
  version: string
  sql: string
}

// Derive { version, sql } from the glob, keep only NNNN_*.sql, sort ascending
// by filename so migrations apply in order.
const MIGRATIONS: Migration[] = Object.entries(migrationModules)
  .map(([path, sql]) => ({ version: path.split('/').pop() ?? path, sql }))
  .filter((m) => /^\d+_.*\.sql$/.test(m.version))
  .sort((a, b) => a.version.localeCompare(b.version))

export function runMigrations(db: Database.Database): void {
  // Ensure the migrations table exists first (outside the main transaction so
  // we can query it to decide what to run).
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  // Which versions are already applied?
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  )

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version))

  if (pending.length === 0) return

  // Apply all pending migrations inside a single transaction for atomicity.
  db.transaction(() => {
    for (const { version, sql } of pending) {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      )
    }
  })()
}
