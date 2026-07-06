/**
 * Characterization tests for the AppSettings provider matrix (audit C9).
 *
 * These lock the EXACT parse/reject behaviour of the 15-way provider union
 * (3 extraction × 5 ASR) before the schema-builder refactor, so the builder
 * can be proven behaviour-preserving: same fields, same optionality, same
 * defaults, same cross-slot rejection, same unknown-key handling.
 *
 * The main-process `settings.test.ts` already covers happy-path round-trips
 * per provider; this file deliberately targets the matrix invariants that a
 * builder refactor could silently change (inactive-slot rejection, the always
 * present `anthropic` slot, optionality of individual config fields, the
 * `preset` default, and unknown-key stripping).
 */

import { describe, expect, it } from 'vitest'

import {
  AppSettingsSchema,
  type AppSettings,
  type AzureOpenAIConfig,
  type AzureSpeechConfig,
  type LocalExtractionConfig,
  type MistralVoxtralConfig,
  type OpenAIAudioConfig,
  type OpenAICompatibleConfig,
} from './settingsSchema'

// ---------------------------------------------------------------------------
// Fixtures: one valid config value per provider slot
// ---------------------------------------------------------------------------

const anthropicCfg = {
  rollingModel: 'claude-haiku-4-5',
  finalPassModel: 'claude-sonnet-4-6',
}

const openaiCompatibleCfg: OpenAICompatibleConfig = {
  preset: 'custom',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  keyRef: 'my-llm-key',
  displayName: 'My LLM',
}

const azureOpenAICfg: AzureOpenAIConfig = {
  endpoint: 'https://my-resource.openai.azure.com/',
  deployment: 'my-gpt-deployment',
  apiVersion: '2024-12-01-preview',
  model: 'gpt-4o',
  keyRef: 'azure-key',
  displayName: 'Azure OpenAI',
}

const localCfg: LocalExtractionConfig = {
  preset: 'local-custom',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model',
  keyRef: 'local',
  displayName: 'Lokaal',
}

const deepgramCfg = { language: 'nl' }

const openaiAudioCfg: OpenAIAudioConfig = {
  model: 'gpt-4o-mini-transcribe',
  keyRef: 'openai-key',
  displayName: 'OpenAI Audio',
}

const mistralVoxtralCfg: MistralVoxtralConfig = {
  model: 'voxtral-mini-2507',
  keyRef: 'mistral-key',
  displayName: 'Mistral Voxtral',
}

const azureSpeechCfg: AzureSpeechConfig = {
  endpoint: 'https://my-resource.cognitiveservices.azure.com/',
  deployment: 'my-speech-deployment',
  apiVersion: '2024-02-15-preview',
  model: 'whisper',
  keyRef: 'azure-speech-key',
  displayName: 'Azure Speech',
}

type Ext = 'anthropic' | 'openai-compatible' | 'azure-openai' | 'local'
type Asr = 'local-parakeet' | 'deepgram' | 'openai-audio' | 'mistral-voxtral' | 'azure-speech'

const EXT_PROVIDERS: Ext[] = ['anthropic', 'openai-compatible', 'azure-openai', 'local']
const ASR_PROVIDERS: Asr[] = [
  'local-parakeet',
  'deepgram',
  'openai-audio',
  'mistral-voxtral',
  'azure-speech',
]

/** Slot that must be present for a given extraction provider (undefined = none). */
function extractionSlot(ext: Ext): Record<string, unknown> {
  switch (ext) {
    case 'anthropic':
      return {}
    case 'openai-compatible':
      return { openaiCompatible: openaiCompatibleCfg }
    case 'azure-openai':
      return { azureOpenAI: azureOpenAICfg }
    case 'local':
      return { local: localCfg }
  }
}

/** Slot that must be present for a given ASR provider (local-parakeet needs none). */
function asrSlot(asr: Asr): Record<string, unknown> {
  switch (asr) {
    case 'local-parakeet':
      return {}
    case 'deepgram':
      return { deepgram: deepgramCfg }
    case 'openai-audio':
      return { openaiAudio: openaiAudioCfg }
    case 'mistral-voxtral':
      return { mistralVoxtral: mistralVoxtralCfg }
    case 'azure-speech':
      return { azureSpeech: azureSpeechCfg }
  }
}

/** Build a minimally-valid settings object for a given (ASR, extraction) cell. */
function buildValid(asr: Asr, ext: Ext): Record<string, unknown> {
  return {
    asrProvider: asr,
    extractionProvider: ext,
    primaryLanguage: 'nl',
    ...extractionSlot(ext),
    ...asrSlot(asr),
  }
}

// ---------------------------------------------------------------------------
// The full matrix parses
// ---------------------------------------------------------------------------

describe('AppSettings provider matrix — all provider combinations parse', () => {
  for (const ext of EXT_PROVIDERS) {
    for (const asr of ASR_PROVIDERS) {
      it(`parses ${ext} extraction + ${asr} ASR`, () => {
        const result = AppSettingsSchema.safeParse(buildValid(asr, ext))
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.asrProvider).toBe(asr)
          expect(result.data.extractionProvider).toBe(ext)
        }
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Missing the active config for a provider is rejected
// ---------------------------------------------------------------------------

describe('AppSettings — a provider without its required config is rejected', () => {
  it('rejects openai-audio ASR with no openaiAudio block', () => {
    const input = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects mistral-voxtral ASR with no mistralVoxtral block', () => {
    const input = {
      asrProvider: 'mistral-voxtral',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects azure-speech ASR with no azureSpeech block', () => {
    const input = {
      asrProvider: 'azure-speech',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects openai-compatible extraction with no openaiCompatible block', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects azure-openai extraction with no azureOpenAI block', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('accepts deepgram ASR with no deepgram block (deepgram config is optional)', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// A config on an INACTIVE slot is rejected (cross-slot leakage guard)
// ---------------------------------------------------------------------------

describe('AppSettings — a config on the wrong slot is rejected', () => {
  it('rejects local-parakeet ASR carrying a deepgram config', () => {
    const input = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      deepgram: deepgramCfg,
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects deepgram ASR carrying an openaiAudio config', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: openaiAudioCfg,
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects anthropic extraction carrying an openaiCompatible config', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiCompatible: openaiCompatibleCfg,
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects openai-compatible extraction carrying an azureOpenAI config', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: openaiCompatibleCfg,
      azureOpenAI: azureOpenAICfg,
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The `anthropic` slot is allowed on EVERY variant (quirk to preserve)
// ---------------------------------------------------------------------------

describe('AppSettings — the anthropic slot is accepted regardless of extraction provider', () => {
  it('accepts an anthropic block alongside openai-compatible extraction', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      anthropic: anthropicCfg,
      openaiCompatible: openaiCompatibleCfg,
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(true)
  })

  it('accepts an anthropic block alongside azure-openai extraction', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      anthropic: anthropicCfg,
      azureOpenAI: azureOpenAICfg,
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(true)
  })

  it('accepts an anthropic block that is omitted entirely (it is optional)', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Per-field optionality and validation, per slot
// ---------------------------------------------------------------------------

describe('AppSettings — per-field validation is preserved', () => {
  it('rejects empty primaryLanguage', () => {
    expect(
      AppSettingsSchema.safeParse({
        asrProvider: 'deepgram',
        extractionProvider: 'anthropic',
        primaryLanguage: '',
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown ASR provider', () => {
    expect(
      AppSettingsSchema.safeParse({
        asrProvider: 'whisper-cloud',
        extractionProvider: 'anthropic',
        primaryLanguage: 'nl',
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown extraction provider', () => {
    expect(
      AppSettingsSchema.safeParse({
        asrProvider: 'deepgram',
        extractionProvider: 'ollama',
        primaryLanguage: 'nl',
      }).success,
    ).toBe(false)
  })

  it('rejects openaiAudio with empty model', () => {
    const input = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: { ...openaiAudioCfg, model: '' },
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('accepts openaiAudio without the optional language field', () => {
    const input = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: { model: 'gpt-4o-mini-transcribe', keyRef: 'k', displayName: 'd' },
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(true)
  })

  it('rejects openai-compatible with an invalid base URL', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: { ...openaiCompatibleCfg, baseUrl: 'not-a-url' },
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('rejects openai-compatible with an empty keyRef', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: { ...openaiCompatibleCfg, keyRef: '' },
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('parses a local extractor with a loopback base URL', () => {
    const input = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'local',
      primaryLanguage: 'nl',
      local: localCfg,
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success && result.data.extractionProvider === 'local') {
      expect(result.data.local.baseUrl).toBe('http://localhost:1234/v1')
      expect(result.data.local.keyRef).toBe('local')
    }
  })

  it('defaults local.preset to "local-custom" when omitted', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'local',
      primaryLanguage: 'nl',
      local: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
        keyRef: 'local',
        displayName: 'Lokaal',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success && result.data.extractionProvider === 'local') {
      expect(result.data.local.preset).toBe('local-custom')
    }
  })

  it('rejects local extraction with no local block', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'local',
      primaryLanguage: 'nl',
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('defaults openaiCompatible.preset to "custom" when omitted', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
        keyRef: 'my-llm-key',
        displayName: 'My LLM',
      },
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success && result.data.extractionProvider === 'openai-compatible') {
      expect(result.data.openaiCompatible.preset).toBe('custom')
    }
  })

  it('rejects azure-openai without apiVersion (required for azure-openai)', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'd',
        model: 'gpt-4o',
        keyRef: 'azure-key',
        displayName: 'Azure OpenAI',
      },
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('accepts azure-speech without apiVersion (optional for azure-speech)', () => {
    const input = {
      asrProvider: 'azure-speech',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      azureSpeech: {
        endpoint: 'https://my-resource.cognitiveservices.azure.com/',
        deployment: 'd',
        model: 'whisper',
        keyRef: 'azure-speech-key',
        displayName: 'Azure Speech',
      },
    }
    expect(AppSettingsSchema.safeParse(input).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unknown-key handling: the schema strips extras, it does not reject them
// ---------------------------------------------------------------------------

describe('AppSettings — unknown top-level keys are stripped, not rejected', () => {
  it('parses successfully and drops an unknown key', () => {
    const input = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      somethingUnknown: 'ignored',
    }
    const result = AppSettingsSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect('somethingUnknown' in result.data).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Type-level lock: the discriminated union still narrows for consumers.
// If the builder changed the inferred shape (e.g. made active slots optional
// or unioned every slot with undefined), these accesses would stop type-
// checking, failing the typecheck gate rather than the runtime assertion.
// ---------------------------------------------------------------------------

// Taking `AppSettings` as a parameter (not a narrowed const initializer) keeps
// the variable at the full union type, so the switch exercises real
// discriminant narrowing. If the builder made active slots optional or unioned
// every slot with `undefined`, the `.keyRef` accesses below would stop
// type-checking and fail the typecheck gate.
function extractionKeyRef(settings: AppSettings): string {
  switch (settings.extractionProvider) {
    case 'anthropic':
      return 'anthropic'
    case 'openai-compatible':
      return settings.openaiCompatible.keyRef
    case 'azure-openai':
      return settings.azureOpenAI.keyRef
    case 'local':
      return settings.local.keyRef
  }
}

function asrKeyRef(settings: AppSettings): string | null {
  switch (settings.asrProvider) {
    case 'local-parakeet':
      return null
    case 'deepgram':
      return null
    case 'openai-audio':
      return settings.openaiAudio.keyRef
    case 'mistral-voxtral':
      return settings.mistralVoxtral.keyRef
    case 'azure-speech':
      return settings.azureSpeech.keyRef
  }
}

describe('AppSettings — inferred type narrows on the discriminants', () => {
  it('narrows openaiCompatible / azureOpenAI as required in their extraction variants', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: openaiCompatibleCfg,
    }
    expect(extractionKeyRef(settings)).toBe('my-llm-key')
  })

  it('narrows the active ASR slot as required in its variant', () => {
    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: openaiAudioCfg,
    }
    expect(asrKeyRef(settings)).toBe('openai-key')
  })
})
