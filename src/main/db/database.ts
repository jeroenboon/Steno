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
