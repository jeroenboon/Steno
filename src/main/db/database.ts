/**
 * Database factory.
 *
 * Opens a better-sqlite3 database at the given path (or :memory: for tests).
 * Foreign keys are always enabled. Call runMigrations(db) after opening in
 * production to ensure the schema is up to date.
 */
import Database from 'better-sqlite3'

export function openDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  return db
}

/**
 * Close the database handle on shutdown.
 *
 * WAL mode makes an unclosed handle benign in practice, but closing it on quit
 * is correct hygiene. Two safety properties:
 *   - Idempotent: better-sqlite3 throws if you `close()` an already-closed
 *     handle, so we guard on the `open` flag (safe to call twice / after close).
 *   - Non-throwing: a close failure during app quit must never block shutdown,
 *     so any error from `close()` is swallowed and handed to `onError` (a
 *     devlog sink at the call site) instead of propagating.
 */
export function closeDatabase(
  db: Pick<Database.Database, 'open' | 'close'>,
  onError?: (err: unknown) => void,
): void {
  if (!db.open) return
  try {
    db.close()
  } catch (err) {
    onError?.(err)
  }
}
