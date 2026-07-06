/**
 * @vitest-environment node
 *
 * providerFactory — the live/import × vendor matrix (audit 04-tests Q2).
 *
 * providerFactory forks the ASR side two ways: by configured vendor and, for the
 * cloud streaming vendors (OpenAI / Mistral / Azure), by `usage` ('live' →
 * realtime adapter, 'import' → batch adapter). The extraction side forks by
 * vendor only. Every "wrong provider built for usage X" bug (e.g. a live meeting
 * silently handed a batch adapter, or Azure handed the plain OpenAI adapter)
 * ships past the adapter unit tests, because those only test each adapter in
 * isolation — never the routing that picks between them.
 *
 * This is a characterization matrix over the CURRENT behaviour: for each cell of
 * (usage × configured vendor) it asserts the concrete provider CLASS that comes
 * out, using `constructor.name` as the stable discriminator (matching how the
 * repo identifies providers elsewhere). Two live cells collapse onto the same
 * class by design — Azure reuses the OpenAI Realtime wire (ADR 0028) — so those
 * are additionally pinned by the connection URL the provider would dial, which
 * is the only thing that actually differs between them.
 *
 * Deterministic: MemorySecretStorage (no real safeStorage/FS), no network, no
 * timers. The one Electron touch (local-parakeet reads app.getPath) is mocked,
 * as is the model-download check, so that cell resolves without a real model.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// local-parakeet reads app.getPath('userData') to locate the model dir. Mock it
// so that single cell can be built off the Electron main process.
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/mock/userData/${name}` },
}))

// local-parakeet gates on ModelDownloader.isDownloaded(). Force it true so the
// factory reaches the LocalAsrProvider construction instead of the
// "model not downloaded" degrade branch.
vi.mock('../providers/sherpa/ModelDownloader', () => ({
  ModelDownloader: class {
    isDownloaded(): boolean {
      return true
    }
  },
}))

import { tryBuildAsrProvider, tryBuildExtractionProvider, type AsrUsage } from './providerFactory'
import { MemorySecretStorage } from './SecretStorage'
import type { AppSettings } from './settingsSchema'

// ---------------------------------------------------------------------------
// Settings builders — one valid AppSettings per configured vendor. Extraction
// is pinned to Anthropic in the ASR cases (and ASR to Deepgram in the extraction
// cases) so each test isolates the one fork under scrutiny.
// ---------------------------------------------------------------------------

const ANTHROPIC_EXTRACTION = {
  extractionProvider: 'anthropic',
  primaryLanguage: 'nl',
} as const

function asrSettings(over: Partial<AppSettings>): AppSettings {
  return { ...ANTHROPIC_EXTRACTION, ...over } as AppSettings
}

const OPENAI_AUDIO = {
  model: 'gpt-4o-transcribe',
  keyRef: 'openai-audio',
  displayName: 'OpenAI',
} as const

const MISTRAL_VOXTRAL = {
  model: 'voxtral-mini-2507',
  keyRef: 'mistral',
  displayName: 'Mistral',
} as const

const AZURE_SPEECH = {
  endpoint: 'https://my-resource.openai.azure.com/',
  deployment: 'gpt-4o-transcribe',
  model: 'gpt-4o-transcribe',
  keyRef: 'azure-speech',
  displayName: 'Azure Speech',
} as const

/** Read the realtime provider's would-be connection URL without opening a socket. */
function connectionUrl(provider: unknown, apiKey: string): string {
  const built = (
    provider as { _buildConnection: (key: string) => { url: string } }
  )._buildConnection(apiKey)
  return built.url
}

// ---------------------------------------------------------------------------
// ASR matrix: (vendor × usage) → concrete provider class
// ---------------------------------------------------------------------------

interface AsrCell {
  name: string
  settings: AppSettings
  keys: Record<string, string>
  live: string
  import: string
}

const ASR_CELLS: AsrCell[] = [
  {
    name: 'deepgram',
    settings: asrSettings({ asrProvider: 'deepgram' }),
    keys: { deepgram: 'dg-key' },
    // Deepgram serves both live and import from one adapter.
    live: 'DeepgramAsrProvider',
    import: 'DeepgramAsrProvider',
  },
  {
    name: 'openai-audio',
    settings: asrSettings({ asrProvider: 'openai-audio', openaiAudio: OPENAI_AUDIO }),
    keys: { 'openai-audio': 'oa-key' },
    live: 'OpenAIRealtimeAsrProvider',
    import: 'OpenAIBatchAsrProvider',
  },
  {
    name: 'mistral-voxtral',
    settings: asrSettings({ asrProvider: 'mistral-voxtral', mistralVoxtral: MISTRAL_VOXTRAL }),
    keys: { mistral: 'mi-key' },
    live: 'MistralVoxtralRealtimeAsrProvider',
    import: 'MistralVoxtralBatchAsrProvider',
  },
  {
    name: 'azure-speech',
    settings: asrSettings({ asrProvider: 'azure-speech', azureSpeech: AZURE_SPEECH }),
    keys: { 'azure-speech': 'az-key' },
    // Azure reuses the OpenAI Realtime wire for live (ADR 0028), so the live
    // class name matches OpenAI's; the batch path is Azure's own adapter.
    live: 'OpenAIRealtimeAsrProvider',
    import: 'AzureWhisperBatchAsrProvider',
  },
  {
    name: 'local-parakeet',
    settings: asrSettings({ asrProvider: 'local-parakeet' }),
    keys: {},
    // Local has no live/import fork: a single adapter serves both usages.
    live: 'LocalAsrProvider',
    import: 'LocalAsrProvider',
  },
]

function storageWith(keys: Record<string, string>): MemorySecretStorage {
  const storage = new MemorySecretStorage()
  for (const [k, v] of Object.entries(keys)) storage.setSecret(k, v)
  return storage
}

describe('providerFactory ASR matrix (vendor × usage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const cell of ASR_CELLS) {
    for (const usage of ['live', 'import'] as AsrUsage[]) {
      const expected = usage === 'live' ? cell.live : cell.import
      it(`builds ${expected} for ${cell.name} / ${usage}`, () => {
        const storage = storageWith(cell.keys)
        const result = tryBuildAsrProvider(cell.settings, storage, usage)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.provider.constructor.name).toBe(expected)
      })
    }
  }

  it('dials the OpenAI Realtime endpoint for openai-audio / live', () => {
    const storage = storageWith({ 'openai-audio': 'oa-key' })
    const result = tryBuildAsrProvider(
      asrSettings({ asrProvider: 'openai-audio', openaiAudio: OPENAI_AUDIO }),
      storage,
      'live',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(connectionUrl(result.provider, 'oa-key')).toContain('api.openai.com')
  })

  it('dials the Azure deployment endpoint (not OpenAI) for azure-speech / live', () => {
    const storage = storageWith({ 'azure-speech': 'az-key' })
    const result = tryBuildAsrProvider(
      asrSettings({ asrProvider: 'azure-speech', azureSpeech: AZURE_SPEECH }),
      storage,
      'live',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const url = connectionUrl(result.provider, 'az-key')
    expect(url).toContain('my-resource.openai.azure.com')
    expect(url).not.toContain('api.openai.com')
  })
})

// ---------------------------------------------------------------------------
// Extraction matrix: vendor → concrete provider class
// ---------------------------------------------------------------------------

const OPENAI_COMPATIBLE = {
  preset: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  keyRef: 'openai',
  displayName: 'OpenAI',
} as const

const AZURE_OPENAI = {
  endpoint: 'https://my-resource.openai.azure.com/',
  deployment: 'gpt-4o',
  apiVersion: '2024-12-01-preview',
  model: 'gpt-4o',
  keyRef: 'azure',
  displayName: 'Azure OpenAI',
} as const

interface ExtractionCell {
  name: string
  settings: AppSettings
  keys: Record<string, string>
  expected: string
}

const EXTRACTION_CELLS: ExtractionCell[] = [
  {
    name: 'anthropic',
    settings: { asrProvider: 'deepgram', extractionProvider: 'anthropic', primaryLanguage: 'nl' },
    keys: { anthropic: 'sk-ant' },
    expected: 'AnthropicExtractionProvider',
  },
  {
    name: 'openai-compatible',
    settings: {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: OPENAI_COMPATIBLE,
    },
    keys: { openai: 'sk-oai' },
    expected: 'OpenAICompatibleExtractionProvider',
  },
  {
    name: 'azure-openai',
    settings: {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: AZURE_OPENAI,
    },
    keys: { azure: 'az-key' },
    expected: 'AzureOpenAIExtractionProvider',
  },
]

describe('providerFactory extraction matrix (vendor)', () => {
  for (const cell of EXTRACTION_CELLS) {
    it(`builds ${cell.expected} for ${cell.name}`, () => {
      const storage = storageWith(cell.keys)
      const result = tryBuildExtractionProvider(cell.settings, storage)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.provider.constructor.name).toBe(cell.expected)
    })
  }
})

// ---------------------------------------------------------------------------
// Graceful degrade: a missing key never throws — the factory returns
// { ok: false, error } so a caller can fall back / disable that side without
// crashing (per CLAUDE.md: ASR and extraction are gated independently). The
// Fake-ASR fallback itself lives in the caller, not the factory.
// ---------------------------------------------------------------------------

describe('providerFactory degrade paths (missing key → ok:false, no throw)', () => {
  const ASR_MISSING_KEY: { name: string; settings: AppSettings }[] = [
    { name: 'deepgram', settings: asrSettings({ asrProvider: 'deepgram' }) },
    {
      name: 'openai-audio',
      settings: asrSettings({ asrProvider: 'openai-audio', openaiAudio: OPENAI_AUDIO }),
    },
    {
      name: 'mistral-voxtral',
      settings: asrSettings({ asrProvider: 'mistral-voxtral', mistralVoxtral: MISTRAL_VOXTRAL }),
    },
    {
      name: 'azure-speech',
      settings: asrSettings({ asrProvider: 'azure-speech', azureSpeech: AZURE_SPEECH }),
    },
  ]

  for (const cell of ASR_MISSING_KEY) {
    for (const usage of ['live', 'import'] as AsrUsage[]) {
      it(`ASR ${cell.name} / ${usage} degrades without its key`, () => {
        const storage = new MemorySecretStorage()
        const result = tryBuildAsrProvider(cell.settings, storage, usage)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.length).toBeGreaterThan(0)
      })
    }
  }

  for (const cell of EXTRACTION_CELLS) {
    it(`extraction ${cell.name} degrades without its key`, () => {
      const storage = new MemorySecretStorage()
      const result = tryBuildExtractionProvider(cell.settings, storage)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.length).toBeGreaterThan(0)
    })
  }
})
