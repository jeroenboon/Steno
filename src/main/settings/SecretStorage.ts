/**
 * SecretStorage abstraction (item 0012).
 *
 * The real implementation wraps Electron safeStorage (DPAPI on Windows).
 * Tests inject MemorySecretStorage so no real safeStorage or FS is touched.
 *
 * ## Why an interface?
 * Electron safeStorage cannot be called outside the Electron process (it
 * requires the app to be ready). An interface lets unit tests run in Node
 * without starting Electron. The real adapter (ElectronSecretStorage) is only
 * instantiated in src/main/index.ts.
 *
 * ## Key naming convention
 * Keys are short, stable, opaque identifiers (e.g. 'deepgram', 'anthropic',
 * or the `keyRef` from CustomOpenAIConfig). The caller is responsible for
 * choosing stable key names; the interface makes no assumptions.
 *
 * ## What this is NOT
 * SecretStorage is not a general-purpose keychain. It stores exactly the API
 * keys the user configures for ASR and extraction providers. Nothing else.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SecretStorage {
  /**
   * Encrypt and persist a secret under `key`.
   * On the real implementation this calls safeStorage.encryptString and writes
   * the result to a file in userData. The test fake stores plain text in memory.
   */
  setSecret(key: string, value: string): void

  /**
   * Retrieve and decrypt the secret stored under `key`.
   * Returns null if no secret has been stored for this key.
   */
  getSecret(key: string): string | null

  /**
   * Remove the stored secret for `key`. No-op if the key does not exist.
   */
  deleteSecret(key: string): void
}

// ---------------------------------------------------------------------------
// In-memory fake — for tests only
// ---------------------------------------------------------------------------

/**
 * MemorySecretStorage stores secrets as plain strings in a Map.
 * Used in tests instead of the real Electron safeStorage so that:
 *   - tests run in Node without Electron
 *   - no encrypted files are created during testing
 *   - secrets are isolated per test instance
 */
export class MemorySecretStorage implements SecretStorage {
  private readonly _store = new Map<string, string>()

  setSecret(key: string, value: string): void {
    this._store.set(key, value)
  }

  getSecret(key: string): string | null {
    return this._store.get(key) ?? null
  }

  deleteSecret(key: string): void {
    this._store.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Electron safeStorage adapter — used only in src/main/index.ts
// ---------------------------------------------------------------------------

/**
 * ElectronSecretStorage wraps Electron's safeStorage + a simple file store
 * in userData to persist the encrypted bytes across sessions.
 *
 * safeStorage.encryptString / decryptString are synchronous on Windows
 * (DPAPI). The encrypted Buffer is stored as a base64 string in a JSON file
 * at `<userData>/secrets.json`.
 *
 * This class is only safe to instantiate after the Electron app is ready
 * (safeStorage is not available before that). The main entry point (index.ts)
 * must delay construction until after app.whenReady().
 */
export class ElectronSecretStorage implements SecretStorage {
  private readonly _filePath: string
  private _cache: Record<string, string> = {}
  private _loaded = false

  // Injected so tests can avoid a real fs / safeStorage dependency
  private readonly _safeStorage: SafeStorageAdapter
  private readonly _readFileSync: (path: string) => string
  private readonly _writeFileSync: (path: string, data: string) => void

  constructor(opts: {
    userDataPath: string
    safeStorage: SafeStorageAdapter
    readFileSync: (path: string) => string
    writeFileSync: (path: string, data: string) => void
  }) {
    this._filePath = `${opts.userDataPath}/secrets.json`
    this._safeStorage = opts.safeStorage
    this._readFileSync = opts.readFileSync
    this._writeFileSync = opts.writeFileSync
  }

  private _ensureLoaded(): void {
    if (this._loaded) return
    try {
      const raw = this._readFileSync(this._filePath)
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this._cache = parsed as Record<string, string>
      }
    } catch {
      // File doesn't exist or is corrupt — start fresh
      this._cache = {}
    }
    this._loaded = true
  }

  private _persist(): void {
    this._writeFileSync(this._filePath, JSON.stringify(this._cache))
  }

  setSecret(key: string, value: string): void {
    this._ensureLoaded()
    const encrypted = this._safeStorage.encryptString(value)
    this._cache[key] = encrypted.toString('base64')
    this._persist()
  }

  getSecret(key: string): string | null {
    this._ensureLoaded()
    const encoded = this._cache[key]
    if (encoded === undefined) return null
    const buf = Buffer.from(encoded, 'base64')
    return this._safeStorage.decryptString(buf)
  }

  deleteSecret(key: string): void {
    this._ensureLoaded()
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this._cache[key]
    this._persist()
  }
}

/**
 * Minimal shape of Electron's safeStorage API that we depend on.
 * Abstracting this makes ElectronSecretStorage itself testable without
 * launching Electron (though in practice we don't unit-test that class —
 * MemorySecretStorage covers the interface).
 */
export interface SafeStorageAdapter {
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}
