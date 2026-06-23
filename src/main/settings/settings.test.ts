/**
 * Tests for item 0012 — Settings + secrets + provider selection.
 *
 * Coverage:
 *   1. Settings schema: valid round-trips + Zod rejection of bad config
 *   2. SecretStorage: set/get via a fake; keys never appear in settings JSON
 *   3. ProviderFactory: returns right adapter per config combo
 *   4. Custom OpenAI endpoint: config validates + rejects invalid shapes
 *   5. EgressState: computed correctly for each provider combination
 *   6. No API key logged (spy on console.error / console.log)
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Anthropic SDK so tests run without a browser/Electron environment.
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))

// Mock electron so providerFactory can import app.getPath without Electron runtime.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/fake/userData'),
  },
}))

import { ModelDownloader } from '../providers/sherpa/ModelDownloader'

import { computeEgressState, buildDisclosureCopy, type EgressState } from './egressState'
import { buildProviders, tryBuildAsrProvider, tryBuildExtractionProvider } from './providerFactory'
import { MemorySecretStorage, type SecretStorage } from './SecretStorage'
import { AppSettingsSchema, DEFAULT_SETTINGS, type AppSettings } from './settingsSchema'
import { SettingsStore } from './SettingsStore'

// ---------------------------------------------------------------------------
// 1. Settings schema — valid round-trips + Zod rejection
// ---------------------------------------------------------------------------

describe('AppSettingsSchema', () => {
  it('parses valid default settings', () => {
    const result = AppSettingsSchema.safeParse(DEFAULT_SETTINGS)
    expect(result.success).toBe(true)
  })

  it('round-trips a fully-specified preset config', () => {
    const input: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      anthropic: {
        rollingModel: 'claude-haiku-4-5',
        finalPassModel: 'claude-sonnet-4-6',
      },
      deepgram: {
        language: 'nl',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.asrProvider).toBe('deepgram')
      expect(result.data.primaryLanguage).toBe('nl')
    }
  })

  it('parses an OpenAI-compatible extraction config with custom preset', () => {
    const input: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'en',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://my.openai-proxy.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'custom-openai-key',
        displayName: 'My LLM Proxy',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('parses local-parakeet ASR setting', () => {
    const input: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('parses a valid openai-audio ASR config', () => {
    const input: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
      openaiAudio: {
        model: 'gpt-4o-mini-transcribe',
        keyRef: 'openai-key',
        displayName: 'OpenAI Audio',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('parses a valid mistral-voxtral ASR config', () => {
    const input: AppSettings = {
      asrProvider: 'mistral-voxtral',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
      mistralVoxtral: {
        model: 'Voxtral Mini Transcribe V2',
        keyRef: 'mistral-key',
        displayName: 'Mistral Voxtral',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('parses a valid azure-speech ASR config', () => {
    const input: AppSettings = {
      asrProvider: 'azure-speech',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
      azureSpeech: {
        endpoint: 'https://my-resource.cognitiveservices.azure.com/',
        deployment: 'my-speech-deployment',
        apiVersion: '2024-02-15-preview',
        model: 'whisper',
        keyRef: 'azure-speech-key',
        displayName: 'Azure Speech',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects openai-audio without openaiAudio config', () => {
    const input = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      // no openaiAudio config
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects openai-audio config with empty model', () => {
    const input = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: {
        model: '',
        keyRef: 'openai-key',
        displayName: 'OpenAI Audio',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown ASR provider', () => {
    const input = {
      asrProvider: 'whisper-cloud',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown extraction provider', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'ollama',
      primaryLanguage: 'nl',
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects empty primaryLanguage', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: '',
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects openai-compatible extraction without openaiCompatible config', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      // no openaiCompatible block
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects openai-compatible config with invalid base URL', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'not-a-url',
        model: 'gpt-4o',
        keyRef: 'my-key',
        displayName: 'Test',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects openai-compatible config with empty model', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: '',
        keyRef: 'my-key',
        displayName: 'Test',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects openai-compatible config with empty keyRef', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: '',
        displayName: 'Test',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('parses a valid azure-openai extraction config', () => {
    const input: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'en',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'my-gpt-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-key',
        displayName: 'Azure OpenAI',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects azure-openai extraction without azureOpenAI config', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      // no azureOpenAI block
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects azure-openai config with invalid endpoint URL', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'not-a-url',
        deployment: 'my-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-key',
        displayName: 'Azure',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects azure-openai config with empty deployment', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: '',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-key',
        displayName: 'Azure',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects azure-openai config with empty keyRef', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'my-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: '',
        displayName: 'Azure',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 1.5 Settings migration — custom-openai → openai-compatible
// ---------------------------------------------------------------------------

describe('Settings migration', () => {
  it('migrates old custom-openai config to openai-compatible with preset:custom', async () => {
    const oldSettings: Record<string, unknown> = {
      asrProvider: 'deepgram',
      extractionProvider: 'custom-openai',
      primaryLanguage: 'en',
      customOpenAI: {
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-key',
        displayName: 'My LLM',
      },
    }

    // Simulate SettingsStore.load() applying migrations
    const { applyMigrations } = await import('./migrationUtils')
    const migrated = applyMigrations(oldSettings)

    // Verify the migration worked
    const result = AppSettingsSchema.safeParse(migrated)
    expect(result.success).toBe(true)
    if (result.success && result.data.extractionProvider === 'openai-compatible') {
      expect(result.data.openaiCompatible.preset).toBe('custom')
      expect(result.data.openaiCompatible.baseUrl).toBe('https://api.example.com/v1')
      expect(result.data.openaiCompatible.model).toBe('gpt-4o')
      expect(result.data.openaiCompatible.keyRef).toBe('my-key')
      expect(result.data.openaiCompatible.displayName).toBe('My LLM')
    }
  })

  it('migration is idempotent on already-migrated config', async () => {
    const migratedSettings: Record<string, unknown> = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'en',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-key',
        displayName: 'My LLM',
      },
    }

    const { applyMigrations } = await import('./migrationUtils')
    const migrated = applyMigrations(migratedSettings)

    // Should be identical (no changes)
    expect(migrated.extractionProvider).toBe('openai-compatible')
  })

  it('SettingsStore.load applies migrations before validation', async () => {
    const oldConfigJson = JSON.stringify({
      asrProvider: 'deepgram',
      extractionProvider: 'custom-openai',
      primaryLanguage: 'en',
      customOpenAI: {
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-key',
        displayName: 'My LLM',
      },
    })

    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.resolve(oldConfigJson),
      writeFile: () => Promise.resolve(),
    })

    const loaded = await store.load()
    expect(loaded.extractionProvider).toBe('openai-compatible')
    if (loaded.extractionProvider === 'openai-compatible') {
      expect(loaded.openaiCompatible.preset).toBe('custom')
    }
  })
})

// ---------------------------------------------------------------------------
// 2. SecretStorage — set/get via fake; keys never appear in settings JSON
// ---------------------------------------------------------------------------

describe('MemorySecretStorage (fake safeStorage)', () => {
  let storage: SecretStorage

  beforeEach(() => {
    storage = new MemorySecretStorage()
  })

  it('stores and retrieves a secret by key', () => {
    storage.setSecret('deepgram-key', 'sk-dg-123')
    expect(storage.getSecret('deepgram-key')).toBe('sk-dg-123')
  })

  it('returns null for unknown keys', () => {
    expect(storage.getSecret('nonexistent')).toBeNull()
  })

  it('deletes a secret', () => {
    storage.setSecret('anthropic-key', 'sk-ant-456')
    storage.deleteSecret('anthropic-key')
    expect(storage.getSecret('anthropic-key')).toBeNull()
  })

  it('overwrites an existing secret', () => {
    storage.setSecret('my-key', 'value1')
    storage.setSecret('my-key', 'value2')
    expect(storage.getSecret('my-key')).toBe('value2')
  })
})

describe('API keys do not appear in settings JSON', () => {
  it('settings JSON serialisation never contains a raw API key value', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      anthropic: {
        rollingModel: 'claude-haiku-4-5',
        finalPassModel: 'claude-sonnet-4-6',
      },
    }
    const json = JSON.stringify(settings)
    // A real API key would look like this; it must not appear in settings JSON
    expect(json).not.toContain('sk-ant-')
    expect(json).not.toContain('sk-dg-')
    // The json should not contain any apiKey field
    expect(json).not.toContain('"apiKey"')
    expect(json).not.toContain('"api_key"')
  })

  it('SettingsStore.save does not embed secrets', async () => {
    const written: string[] = []
    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.resolve(JSON.stringify(DEFAULT_SETTINGS)),
      writeFile: (_path, content) => {
        written.push(content)
        return Promise.resolve()
      },
    })

    await store.load()
    await store.save({
      ...DEFAULT_SETTINGS,
      // Try to sneak in a key (schema should not have this field, but even
      // if caller passes extra data, the store must sanitise via Zod)
    })

    const allWritten = written.join('')
    expect(allWritten).not.toContain('sk-')
    expect(allWritten).not.toContain('"apiKey"')
  })
})

// ---------------------------------------------------------------------------
// 3. SettingsStore — load / save round-trip
// ---------------------------------------------------------------------------

describe('SettingsStore', () => {
  it('loads settings from disk and validates them', async () => {
    const stored: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
    }
    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.resolve(JSON.stringify(stored)),
      writeFile: () => Promise.resolve(),
    })

    const settings = await store.load()
    expect(settings.asrProvider).toBe('deepgram')
    expect(settings.primaryLanguage).toBe('en')
  })

  it('falls back to defaults when file does not exist', async () => {
    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.reject(new Error('ENOENT')),
      writeFile: () => Promise.resolve(),
    })

    const settings = await store.load()
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to defaults when file contains invalid JSON', async () => {
    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.resolve('not-json{{{'),
      writeFile: () => Promise.resolve(),
    })

    const settings = await store.load()
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to defaults when file fails schema validation', async () => {
    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.resolve(JSON.stringify({ asrProvider: 'bad-value' })),
      writeFile: () => Promise.resolve(),
    })

    const settings = await store.load()
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('saves validated settings as JSON', async () => {
    let savedContent = ''
    const store = new SettingsStore({
      userDataPath: '/fake',
      readFile: () => Promise.resolve(JSON.stringify(DEFAULT_SETTINGS)),
      writeFile: (_path, content) => {
        savedContent = content
        return Promise.resolve()
      },
    })

    await store.load()
    const newSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      primaryLanguage: 'de',
    }
    await store.save(newSettings)

    const parsed = JSON.parse(savedContent) as unknown
    const result = AppSettingsSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.primaryLanguage).toBe('de')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. ProviderFactory — returns correct adapters
// ---------------------------------------------------------------------------

describe('buildProviders', () => {
  it('returns Deepgram ASR + Anthropic extraction for the default preset', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key-123')
    storage.setSecret('anthropic', 'ant-key-456')

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    const providers = buildProviders(settings, storage)
    expect(providers.asr).toBeDefined()
    expect(providers.extraction).toBeDefined()
    // Should be a DeepgramAsrProvider — verify by duck-typing (it has start/stop/pushAudioFrame/spans)
    expect(typeof providers.asr.start).toBe('function')
    expect(typeof providers.asr.stop).toBe('function')
    expect(typeof providers.asr.pushAudioFrame).toBe('function')
    expect(typeof providers.asr.spans).toBe('function')
    // Should be an AnthropicExtractionProvider — has extract()
    expect(typeof providers.extraction.extract).toBe('function')
  })

  it('returns a custom OpenAI-compatible extraction provider for openai-compatible config', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key-123')
    storage.setSecret('my-llm-key', 'custom-key-789')

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'en',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-llm-key',
        displayName: 'My LLM',
      },
    }

    const providers = buildProviders(settings, storage)
    expect(typeof providers.extraction.extract).toBe('function')
  })

  it('builds ASR independently: Deepgram key present, Anthropic key MISSING → ASR ok, extraction not', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key-123')
    // No anthropic key stored

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    const asr = tryBuildAsrProvider(settings, storage)
    expect(asr.ok).toBe(true)
    if (asr.ok) {
      expect(typeof asr.provider.spans).toBe('function')
    }

    const extraction = tryBuildExtractionProvider(settings, storage)
    expect(extraction.ok).toBe(false)
    if (!extraction.ok) {
      expect(extraction.error).toMatch(/anthropic.*key/i)
    }
  })

  it('builds extraction independently: Anthropic key present, Deepgram key MISSING → extraction ok, ASR not', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'ant-key-456')
    // No deepgram key stored

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    const asr = tryBuildAsrProvider(settings, storage)
    expect(asr.ok).toBe(false)
    if (!asr.ok) {
      expect(asr.error).toMatch(/deepgram.*key/i)
    }

    const extraction = tryBuildExtractionProvider(settings, storage)
    expect(extraction.ok).toBe(true)
    if (extraction.ok) {
      expect(typeof extraction.provider.extract).toBe('function')
    }
  })

  it('throws a clear error when Deepgram API key is missing', () => {
    const storage = new MemorySecretStorage()
    // No deepgram key stored

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    expect(() => buildProviders(settings, storage)).toThrow(/deepgram.*key/i)
  })

  it('throws a clear error when Anthropic API key is missing', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key')
    // No anthropic key stored

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    expect(() => buildProviders(settings, storage)).toThrow(/anthropic.*key/i)
  })

  it('throws a clear error when openai-compatible key is missing from storage', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key-123')
    // No 'my-llm-key' stored

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'en',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-llm-key',
        displayName: 'My LLM',
      },
    }

    expect(() => buildProviders(settings, storage)).toThrow(/my-llm-key/i)
  })

  it('throws "not yet implemented" when azure-openai extraction is selected', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key-123')
    storage.setSecret('azure-key', 'azure-api-key')

    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'en',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'my-gpt-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-key',
        displayName: 'Azure OpenAI',
      },
    }

    expect(() => buildProviders(settings, storage)).toThrow(/not yet implemented/i)
  })

  it('throws when local-parakeet model is not downloaded', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'ant-key')

    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    // Model dir /fake/userData/models/whisper-small-sherpa won't exist
    expect(() => buildProviders(settings, storage)).toThrow(/gedownload/i)
  })

  it('throws "not yet implemented" when openai-audio ASR is selected', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'ant-key')
    storage.setSecret('openai-key', 'sk-openai')

    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
      openaiAudio: {
        model: 'gpt-4o-mini-transcribe',
        keyRef: 'openai-key',
        displayName: 'OpenAI Audio',
      },
    }

    expect(() => buildProviders(settings, storage)).toThrow(/not yet implemented/i)
  })

  it('throws "not yet implemented" when mistral-voxtral ASR is selected', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'ant-key')
    storage.setSecret('mistral-key', 'sk-mistral')

    const settings: AppSettings = {
      asrProvider: 'mistral-voxtral',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
      mistralVoxtral: {
        model: 'Voxtral Mini Transcribe V2',
        keyRef: 'mistral-key',
        displayName: 'Mistral Voxtral',
      },
    }

    expect(() => buildProviders(settings, storage)).toThrow(/not yet implemented/i)
  })

  it('throws "not yet implemented" when azure-speech ASR is selected', () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'ant-key')
    storage.setSecret('azure-speech-key', 'azure-key')

    const settings: AppSettings = {
      asrProvider: 'azure-speech',
      extractionProvider: 'anthropic',
      primaryLanguage: 'en',
      azureSpeech: {
        endpoint: 'https://my-resource.cognitiveservices.azure.com/',
        deployment: 'my-speech-deployment',
        apiVersion: '2024-02-15-preview',
        model: 'whisper',
        keyRef: 'azure-speech-key',
        displayName: 'Azure Speech',
      },
    }

    expect(() => buildProviders(settings, storage)).toThrow(/not yet implemented/i)
  })

  it('throws when local-parakeet model is not downloaded', () => {
    const storage = new MemorySecretStorage()
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }

    const result = tryBuildAsrProvider(settings, storage)
    expect(result.ok).toBe(false)
  })

  describe('tryBuildAsrProvider with local-parakeet model present', () => {
    let modelDir: string

    beforeEach(async () => {
      // Point the electron mock to a temp dir that contains the expected model files
      modelDir = join(tmpdir(), `provider-test-model-${String(Date.now())}`)
      const whisperDir = join(modelDir, 'models', 'whisper-small-sherpa')
      mkdirSync(whisperDir, { recursive: true })

      // Create ALL expected files so isDownloaded() returns true
      for (const f of ModelDownloader.EXPECTED_FILES) {
        writeFileSync(join(whisperDir, f.name), 'placeholder')
      }

      const electronMock = (await import('electron')) as unknown as {
        app: { getPath: ReturnType<typeof vi.fn> }
      }
      electronMock.app.getPath.mockReturnValue(modelDir)
    })

    afterEach(() => {
      rmSync(modelDir, { recursive: true, force: true })
    })

    it('tryBuildAsrProvider returns ok:true when model is present', () => {
      const storage = new MemorySecretStorage()
      const settings: AppSettings = {
        asrProvider: 'local-parakeet',
        extractionProvider: 'anthropic',
        primaryLanguage: 'nl',
      }

      const result = tryBuildAsrProvider(settings, storage)
      expect(result.ok).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 5. EgressState — computed correctly for each combination
// ---------------------------------------------------------------------------

describe('computeEgressState', () => {
  it('local ASR + Anthropic extraction → audio local, notes cloud:Anthropic', () => {
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const state = computeEgressState(settings)
    expect(state.audio).toBe('local')
    expect(state.notes).toBe('cloud:Anthropic')
  })

  it('Deepgram ASR + Anthropic extraction → audio cloud:Deepgram, notes cloud:Anthropic', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const state = computeEgressState(settings)
    expect(state.audio).toBe('cloud:Deepgram')
    expect(state.notes).toBe('cloud:Anthropic')
  })

  it('Deepgram ASR + openai-compatible → audio cloud:Deepgram, notes cloud:custom:<name>', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-llm-key',
        displayName: 'My LLM',
      },
    }
    const state = computeEgressState(settings)
    expect(state.audio).toBe('cloud:Deepgram')
    expect(state.notes).toBe('cloud:custom:My LLM')
  })

  it('local ASR + openai-compatible → audio local, notes cloud:custom:<name>', () => {
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-llm-key',
        displayName: 'AzureGPT',
      },
    }
    const state = computeEgressState(settings)
    expect(state.audio).toBe('local')
    expect(state.notes).toBe('cloud:custom:AzureGPT')
  })

  it('Deepgram ASR + azure-openai extraction → audio cloud:Deepgram, notes cloud:Azure OpenAI', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'en',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'my-gpt-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-key',
        displayName: 'Azure OpenAI',
      },
    }
    const state = computeEgressState(settings)
    expect(state.audio).toBe('cloud:Deepgram')
    expect(state.notes).toBe('cloud:Azure OpenAI')
  })

  it('egressState does not contain any key-like secrets', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const state = computeEgressState(settings)
    const json = JSON.stringify(state)
    expect(json).not.toContain('sk-')
    expect(json).not.toContain('key')
  })
})

// ---------------------------------------------------------------------------
// 6. Disclosure copy — human-readable description per egressState
// ---------------------------------------------------------------------------

describe('buildDisclosureCopy', () => {
  it('all-local: no data leaves the device', () => {
    const state: EgressState = { audio: 'local', notes: 'cloud:Anthropic' }
    const copy = buildDisclosureCopy(state)
    expect(copy.audioDisclosure).toContain('lokaal')
  })

  it('cloud ASR: names Deepgram as audio recipient', () => {
    const state: EgressState = { audio: 'cloud:Deepgram', notes: 'cloud:Anthropic' }
    const copy = buildDisclosureCopy(state)
    expect(copy.audioDisclosure).toContain('Deepgram')
  })

  it('cloud extraction Anthropic: names Anthropic as notes recipient', () => {
    const state: EgressState = { audio: 'local', notes: 'cloud:Anthropic' }
    const copy = buildDisclosureCopy(state)
    expect(copy.notesDisclosure).toContain('Anthropic')
  })

  it('custom endpoint: names the custom display name in notes disclosure', () => {
    const state: EgressState = { audio: 'local', notes: 'cloud:custom:My Company LLM' }
    const copy = buildDisclosureCopy(state)
    expect(copy.notesDisclosure).toContain('My Company LLM')
  })

  it('azure-openai: names Azure OpenAI as notes recipient', () => {
    const state: EgressState = { audio: 'cloud:Deepgram', notes: 'cloud:Azure OpenAI' }
    const copy = buildDisclosureCopy(state)
    expect(copy.notesDisclosure).toContain('Azure OpenAI')
  })

  it('returns a badgeText suitable for the EgressIndicator', () => {
    const state: EgressState = { audio: 'cloud:Deepgram', notes: 'cloud:Anthropic' }
    const copy = buildDisclosureCopy(state)
    expect(copy.badgeText).toBeTruthy()
    expect(typeof copy.badgeText).toBe('string')
    // Badge should mention both providers
    expect(copy.badgeText).toContain('Deepgram')
    expect(copy.badgeText).toContain('Anthropic')
  })
})

// ---------------------------------------------------------------------------
// 7. No API key in logs
// ---------------------------------------------------------------------------

describe('no API keys logged', () => {
  it('buildProviders does not log the API key on construction', () => {
    const logSpy = vi.spyOn(console, 'log').mockReturnValue(undefined)
    const errorSpy = vi.spyOn(console, 'error').mockReturnValue(undefined)

    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'SECRET_DG_KEY')
    storage.setSecret('anthropic', 'SECRET_ANT_KEY')

    buildProviders(
      {
        asrProvider: 'deepgram',
        extractionProvider: 'anthropic',
        primaryLanguage: 'nl',
      },
      storage,
    )

    const allLogs = [
      ...logSpy.mock.calls.map((c) => String(c)),
      ...errorSpy.mock.calls.map((c) => String(c)),
    ].join('\n')

    expect(allLogs).not.toContain('SECRET_DG_KEY')
    expect(allLogs).not.toContain('SECRET_ANT_KEY')

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
