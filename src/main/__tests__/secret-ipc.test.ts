/**
 * Tests for item 0016 — secret IPC handlers (main side).
 *
 * Coverage:
 *   1. secret:set — stores via SecretStorage, returns { ok: true }
 *   2. secret:set — the stored value never appears in the settings JSON
 *   3. secret:has — returns true when key exists, false when absent
 *   4. buildProviders graceful path — missing key yields a clear error state, no crash
 *
 * No real safeStorage, no network. MemorySecretStorage injected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Anthropic SDK so tests run in Node without a real HTTP client.
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))

import { DEFAULT_SETTINGS } from '../../shared/settings/settingsSchema'
import { createIpcRegistry } from '../ipc-registry'
import { tryBuildProviders } from '../settings/providerFactory'
import { MemorySecretStorage } from '../settings/SecretStorage'
import { SettingsStore } from '../settings/SettingsStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(storage: MemorySecretStorage) {
  const store = new SettingsStore({
    userDataPath: '/fake',
    readFile: () => Promise.resolve(JSON.stringify(DEFAULT_SETTINGS)),
    writeFile: () => Promise.resolve(),
  })

  // Pre-load so store.current is available
  return store
    .load()
    .then(() => createIpcRegistry({ settingsStore: store, secretStorage: storage }))
}

// ---------------------------------------------------------------------------
// 1 + 2: secret:set
// ---------------------------------------------------------------------------

describe('secret:set IPC handler', () => {
  let storage: MemorySecretStorage

  beforeEach(() => {
    storage = new MemorySecretStorage()
  })

  it('stores the secret and returns { ok: true }', async () => {
    const registry = await makeRegistry(storage)
    const result = await registry.dispatch('secret:set', { key: 'deepgram', value: 'sk-dg-test' })
    expect(result).toEqual({ ok: true })
    expect(storage.getSecret('deepgram')).toBe('sk-dg-test')
  })

  it('the stored value does NOT appear in any serialised settings payload', async () => {
    const registry = await makeRegistry(storage)
    await registry.dispatch('secret:set', { key: 'anthropic', value: 'SECRET_API_KEY' })

    // settings:get must not leak the secret
    const settings = await registry.dispatch('settings:get', {})
    const json = JSON.stringify(settings)
    expect(json).not.toContain('SECRET_API_KEY')
  })

  it('overwrites an existing secret without error', async () => {
    const registry = await makeRegistry(storage)
    await registry.dispatch('secret:set', { key: 'deepgram', value: 'old-key' })
    await registry.dispatch('secret:set', { key: 'deepgram', value: 'new-key' })
    expect(storage.getSecret('deepgram')).toBe('new-key')
  })

  it('rejects if the key payload is invalid (missing key field)', async () => {
    const registry = await makeRegistry(storage)
    await expect(registry.dispatch('secret:set', { value: 'some-value' })).rejects.toThrow()
  })

  it('rejects if the value is empty', async () => {
    const registry = await makeRegistry(storage)
    await expect(registry.dispatch('secret:set', { key: 'deepgram', value: '' })).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3: secret:has
// ---------------------------------------------------------------------------

describe('secret:has IPC handler', () => {
  let storage: MemorySecretStorage

  beforeEach(() => {
    storage = new MemorySecretStorage()
  })

  it('returns { has: false } when no secret is stored for the key', async () => {
    const registry = await makeRegistry(storage)
    const result = await registry.dispatch('secret:has', { key: 'deepgram' })
    expect(result).toEqual({ has: false })
  })

  it('returns { has: true } after a secret is stored', async () => {
    const registry = await makeRegistry(storage)
    storage.setSecret('deepgram', 'dg-key-123')
    const result = await registry.dispatch('secret:has', { key: 'deepgram' })
    expect(result).toEqual({ has: true })
  })

  it('returns { has: false } for a different key after storing a different key', async () => {
    const registry = await makeRegistry(storage)
    storage.setSecret('anthropic', 'ant-key')
    const result = await registry.dispatch('secret:has', { key: 'deepgram' })
    expect(result).toEqual({ has: false })
  })

  it('rejects if the key field is missing', async () => {
    const registry = await makeRegistry(storage)
    await expect(registry.dispatch('secret:has', {})).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 4: missing-key graceful path (buildProviders integration)
// ---------------------------------------------------------------------------

describe('provider wiring — missing key yields graceful error state', () => {
  it('tryBuildProviders returns an error result when Deepgram key is absent', () => {
    const storage = new MemorySecretStorage()
    // No deepgram key stored
    storage.setSecret('anthropic', 'ant-key')

    const result = tryBuildProviders(DEFAULT_SETTINGS, storage)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/deepgram/i)
    }
  })

  it('tryBuildProviders returns providers when both keys are present', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key')
    storage.setSecret('anthropic', 'ant-key')

    const result = tryBuildProviders(DEFAULT_SETTINGS, storage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.providers.asr.start).toBe('function')
      expect(typeof result.providers.extraction.extract).toBe('function')
    }
  })

  it('tryBuildProviders returns an error result when Anthropic key is absent', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key')
    // No anthropic key

    const result = tryBuildProviders(DEFAULT_SETTINGS, storage)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/anthropic/i)
    }
  })
})
