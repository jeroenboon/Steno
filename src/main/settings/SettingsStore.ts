/**
 * SettingsStore (item 0012).
 *
 * Loads and saves AppSettings as validated JSON in the userData directory.
 * The file path is injectable for tests (no real FS in unit tests).
 *
 * ## What is stored
 * Only AppSettings fields (provider selection, model overrides, language).
 * API keys are stored separately via SecretStorage and are never written here.
 *
 * ## Error handling
 * - File not found → returns DEFAULT_SETTINGS (first run)
 * - Corrupt JSON → returns DEFAULT_SETTINGS (graceful degradation)
 * - Schema validation failure → returns DEFAULT_SETTINGS (future-proof)
 *
 * ## Injection
 * `readFile` and `writeFile` are injected so tests can avoid real FS I/O.
 * Production code passes `fs.promises.readFile` and `fs.promises.writeFile`.
 */

import path from 'node:path'

import { applyMigrations } from './migrationUtils'
import { AppSettingsSchema, DEFAULT_SETTINGS, type AppSettings } from './settingsSchema'

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface SettingsStoreOptions {
  /** Path to the userData directory (or a fake path in tests). */
  userDataPath: string
  /** Async function that reads a file and returns its string contents. */
  readFile: (filePath: string) => Promise<string>
  /** Async function that writes string content to a file. */
  writeFile: (filePath: string, content: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

const SETTINGS_FILENAME = 'settings.json'

export class SettingsStore {
  private readonly _filePath: string
  private readonly _readFile: (filePath: string) => Promise<string>
  private readonly _writeFile: (filePath: string, content: string) => Promise<void>
  private _current: AppSettings | null = null

  constructor(opts: SettingsStoreOptions) {
    this._filePath = path.join(opts.userDataPath, SETTINGS_FILENAME)
    this._readFile = opts.readFile
    this._writeFile = opts.writeFile
  }

  /**
   * Load settings from disk.
   * Falls back to DEFAULT_SETTINGS on any error (missing file, bad JSON,
   * schema validation failure).
   *
   * Applies forward migrations before validation so old configs are automatically
   * upgraded.
   *
   * Never throws.
   */
  async load(): Promise<AppSettings> {
    try {
      const raw = await this._readFile(this._filePath)
      const parsed: unknown = JSON.parse(raw)
      // Apply forward migrations to support schema evolution
      const migrated = applyMigrations(parsed as Record<string, unknown>)
      const result = AppSettingsSchema.safeParse(migrated)
      if (!result.success) {
        this._current = DEFAULT_SETTINGS
        return DEFAULT_SETTINGS
      }
      this._current = result.data
      return result.data
    } catch {
      this._current = DEFAULT_SETTINGS
      return DEFAULT_SETTINGS
    }
  }

  /**
   * Validate and persist settings to disk.
   * The settings are re-validated before writing so even if a caller passes
   * a partially-typed object, only schema-valid data is persisted.
   *
   * Throws ZodError if `settings` fails validation (caller should handle this).
   */
  async save(settings: AppSettings): Promise<void> {
    // Re-parse to strip any extra fields and guarantee the JSON is clean
    const validated = AppSettingsSchema.parse(settings)
    this._current = validated
    const json = JSON.stringify(validated, null, 2)
    await this._writeFile(this._filePath, json)
  }

  /**
   * Return the in-memory settings (last loaded or saved).
   * Throws if load() has not been called yet.
   */
  get current(): AppSettings {
    if (this._current === null) {
      throw new Error('SettingsStore: call load() before accessing current settings')
    }
    return this._current
  }
}
