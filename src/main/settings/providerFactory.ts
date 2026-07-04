/**
 * Provider factory (item 0012).
 *
 * Given validated AppSettings and a SecretStorage instance, constructs and
 * returns the configured ASRProvider and ExtractionProvider.
 *
 * ## Why a factory function?
 * The providers (DeepgramAsrProvider, AnthropicExtractionProvider,
 * OpenAICompatibleExtractionProvider) require API keys at construction time. Those
 * keys live in SecretStorage. The factory is the single place where settings
 * are wired to secrets to produce provider instances. This keeps all key
 * handling in the main process and out of the domain core.
 *
 * ## local-parakeet
 * The 'local-parakeet' ASR option is included in the settings enum (so the
 * egressState can report audio as 'local' and so the setting persists across
 * restarts), but the provider implementation ships in item 0023. Until then,
 * calling buildProviders with asrProvider='local-parakeet' throws a clear
 * "not yet implemented" error. The error is descriptive so that any accidental
 * call is immediately diagnosable. See ADR 0012.
 *
 * ## No API key logging
 * Keys are retrieved from storage and passed directly to provider constructors.
 * They are never logged here (or in the provider constructors).
 */

import { join } from 'node:path'

import { app } from 'electron'

import type { ASRProvider, ExtractionProvider } from '@shared/providers'

import {
  AnthropicExtractionProvider,
  type AnthropicExtractionProviderOptions,
} from '../providers/AnthropicExtractionProvider'
import { AzureOpenAIExtractionProvider } from '../providers/AzureOpenAIExtractionProvider'
import { createAzureOpenAIRealtimeAsrProvider } from '../providers/AzureOpenAIRealtimeAsrProvider'
import { AzureWhisperBatchAsrProvider } from '../providers/AzureWhisperBatchAsrProvider'
import { DeepgramAsrProvider } from '../providers/DeepgramAsrProvider'
import { LocalAsrProvider } from '../providers/LocalAsrProvider'
import { MistralVoxtralBatchAsrProvider } from '../providers/MistralVoxtralBatchAsrProvider'
import { MistralVoxtralRealtimeAsrProvider } from '../providers/MistralVoxtralRealtimeAsrProvider'
import { OpenAIBatchAsrProvider } from '../providers/OpenAIBatchAsrProvider'
import { OpenAICompatibleExtractionProvider } from '../providers/OpenAICompatibleExtractionProvider'
import { OpenAIRealtimeAsrProvider } from '../providers/OpenAIRealtimeAsrProvider'
import { ModelDownloader } from '../providers/sherpa/ModelDownloader'

import type { SecretStorage } from './SecretStorage'
import type { AppSettings } from './settingsSchema'

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface BuiltProviders {
  asr: ASRProvider
  extraction: ExtractionProvider
}

/**
 * Result type for tryBuildProviders — avoids throwing on missing keys.
 * On success: { ok: true, providers }
 * On failure: { ok: false, error: <human-readable reason> }
 */
export type BuildProvidersResult =
  | { ok: true; providers: BuiltProviders }
  | { ok: false; error: string }

/**
 * Result types for the INDEPENDENT builders. ASR and extraction are gated on
 * different keys (Deepgram vs Anthropic/custom), so a missing extraction key
 * must never disable a working ASR provider, and vice-versa. The combined
 * tryBuildProviders is all-or-nothing and is kept only for callers that
 * genuinely need both at once.
 */
export type BuildAsrResult = { ok: true; provider: ASRProvider } | { ok: false; error: string }

/**
 * Whether the ASR provider is being built for a live meeting or a file import.
 * The OpenAI/Mistral/Azure vendors now expose both modes: a realtime streaming
 * adapter for `'live'` (Phase 4) and a batch adapter for `'import'`. The factory
 * picks per usage. Deepgram/Local serve both modes from a single adapter.
 */
export type AsrUsage = 'live' | 'import'

// Default endpoints for the batch ASR providers whose settings carry no baseUrl.
const OPENAI_AUDIO_BASE_URL = 'https://api.openai.com/v1'
const MISTRAL_AUDIO_BASE_URL = 'https://api.mistral.ai/v1'
const DEFAULT_AZURE_WHISPER_API_VERSION = '2024-06-01'
// Realtime uses a preview api-version distinct from the batch Whisper default.
const DEFAULT_AZURE_REALTIME_API_VERSION = '2024-10-01-preview'
export type BuildExtractionResult =
  | { ok: true; provider: ExtractionProvider }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the configured ASR and extraction providers from settings + secrets.
 *
 * Throws if a required API key is missing from storage, or if an ASR provider
 * is selected that has not yet been implemented (local-parakeet until 0023).
 *
 * @param settings  - Validated AppSettings (from SettingsStore).
 * @param storage   - SecretStorage instance (MemorySecretStorage in tests,
 *                    ElectronSecretStorage in production).
 */
export function buildProviders(settings: AppSettings, storage: SecretStorage): BuiltProviders {
  const asr = buildAsrProvider(settings, storage)
  const extraction = buildExtractionProvider(settings, storage)
  return { asr, extraction }
}

/**
 * Run a throwing builder and turn a thrown missing-key/not-implemented error
 * into an `{ ok: false, error }` result. The single place the three non-throwing
 * variants share; each just relabels the success value (`providers` vs
 * `provider`) to keep its own result contract.
 */
function tryBuild<T>(build: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: build() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Non-throwing variant of buildProviders.
 *
 * Returns a discriminated result type so callers can handle the missing-key
 * case without a try/catch. Used in src/main/index.ts to degrade gracefully
 * when the user hasn't configured their API keys yet (principle: the app must
 * not crash on startup if no key is set).
 *
 * @param settings  - Validated AppSettings.
 * @param storage   - SecretStorage instance.
 */
export function tryBuildProviders(
  settings: AppSettings,
  storage: SecretStorage,
): BuildProvidersResult {
  const result = tryBuild(() => buildProviders(settings, storage))
  return result.ok ? { ok: true, providers: result.value } : result
}

/**
 * Build ONLY the ASR provider. Gated solely on the ASR key (e.g. Deepgram);
 * indifferent to whether an extraction key is configured. This is what the
 * audio pipeline uses so transcription works as soon as the Deepgram key is set.
 */
export function tryBuildAsrProvider(
  settings: AppSettings,
  storage: SecretStorage,
  usage: AsrUsage = 'live',
): BuildAsrResult {
  const result = tryBuild(() => buildAsrProvider(settings, storage, usage))
  return result.ok ? { ok: true, provider: result.value } : result
}

/**
 * Build ONLY the extraction provider. Gated solely on its own key
 * (Anthropic or the custom keyRef); indifferent to the ASR key.
 */
export function tryBuildExtractionProvider(
  settings: AppSettings,
  storage: SecretStorage,
): BuildExtractionResult {
  const result = tryBuild(() => buildExtractionProvider(settings, storage))
  return result.ok ? { ok: true, provider: result.value } : result
}

// ---------------------------------------------------------------------------
// ASR provider construction
// ---------------------------------------------------------------------------

function buildAsrProvider(
  settings: AppSettings,
  storage: SecretStorage,
  usage: AsrUsage = 'live',
): ASRProvider {
  switch (settings.asrProvider) {
    case 'local-parakeet': {
      const modelDir = join(app.getPath('userData'), 'models', 'whisper-small-sherpa')
      const downloader = new ModelDownloader(modelDir)
      if (!downloader.isDownloaded()) {
        throw new Error(
          'Lokaal ASR-model is nog niet gedownload. ' +
            'Open Instellingen en download het model eerst.',
        )
      }
      return new LocalAsrProvider({ modelDir, language: settings.primaryLanguage })
    }

    case 'deepgram': {
      const apiKey = storage.getSecret('deepgram')
      if (apiKey === null) {
        throw new Error(
          'Deepgram API key is not set. ' +
            'Store the key via SecretStorage with the key name "deepgram" before building providers.',
        )
      }
      const language = settings.deepgram?.language ?? settings.primaryLanguage
      return new DeepgramAsrProvider({ apiKey, language })
    }

    case 'openai-audio': {
      const cfg = settings.openaiAudio
      const apiKey = requireKey(storage, cfg.keyRef)
      const language = cfg.language ?? settings.primaryLanguage
      if (usage === 'live') {
        return new OpenAIRealtimeAsrProvider({ apiKey, model: cfg.model, language })
      }
      return new OpenAIBatchAsrProvider({
        apiKey,
        baseUrl: OPENAI_AUDIO_BASE_URL,
        model: cfg.model,
        displayName: cfg.displayName,
        language,
      })
    }

    case 'mistral-voxtral': {
      const cfg = settings.mistralVoxtral
      const apiKey = requireKey(storage, cfg.keyRef)
      const language = cfg.language ?? settings.primaryLanguage
      if (usage === 'live') {
        return new MistralVoxtralRealtimeAsrProvider({ apiKey, model: cfg.model, language })
      }
      return new MistralVoxtralBatchAsrProvider({
        apiKey,
        baseUrl: MISTRAL_AUDIO_BASE_URL,
        model: cfg.model,
        displayName: cfg.displayName,
        language,
      })
    }

    case 'azure-speech': {
      const cfg = settings.azureSpeech
      const apiKey = requireKey(storage, cfg.keyRef)
      const language = cfg.language ?? settings.primaryLanguage
      if (usage === 'live') {
        // Azure reuses the OpenAI Realtime wire (Phase 4.2); the same deployment
        // config drives the realtime URL with a preview api-version default.
        return createAzureOpenAIRealtimeAsrProvider({
          apiKey,
          endpoint: cfg.endpoint,
          deployment: cfg.deployment,
          apiVersion: cfg.apiVersion ?? DEFAULT_AZURE_REALTIME_API_VERSION,
          model: cfg.model,
          language,
        })
      }
      return new AzureWhisperBatchAsrProvider({
        apiKey,
        endpoint: cfg.endpoint,
        deployment: cfg.deployment,
        apiVersion: cfg.apiVersion ?? DEFAULT_AZURE_WHISPER_API_VERSION,
        model: cfg.model,
        displayName: cfg.displayName,
        language,
      })
    }
  }
}

/** Look up a required secret by keyRef, throwing a clear error when absent. */
function requireKey(storage: SecretStorage, keyRef: string): string {
  const apiKey = storage.getSecret(keyRef)
  if (apiKey === null) {
    throw new Error(
      `API key is not set for keyRef "${keyRef}". ` +
        `Store the key via SecretStorage with the key name "${keyRef}" before building providers.`,
    )
  }
  return apiKey
}

// ---------------------------------------------------------------------------
// Extraction provider construction
// ---------------------------------------------------------------------------

function buildExtractionProvider(
  settings: AppSettings,
  storage: SecretStorage,
): ExtractionProvider {
  switch (settings.extractionProvider) {
    case 'anthropic': {
      const apiKey = storage.getSecret('anthropic')
      if (apiKey === null) {
        throw new Error(
          'Anthropic API key is not set. ' +
            'Store the key via SecretStorage with the key name "anthropic" before building providers.',
        )
      }
      const anthropicOpts: AnthropicExtractionProviderOptions = { apiKey }
      if (settings.anthropic?.rollingModel !== undefined) {
        anthropicOpts.rollingModel = settings.anthropic.rollingModel
      }
      if (settings.anthropic?.finalPassModel !== undefined) {
        anthropicOpts.finalPassModel = settings.anthropic.finalPassModel
      }
      return new AnthropicExtractionProvider(anthropicOpts)
    }

    case 'openai-compatible': {
      const { baseUrl, model, keyRef, displayName } = settings.openaiCompatible
      const apiKey = storage.getSecret(keyRef)
      if (apiKey === null) {
        throw new Error(
          `OpenAI-compatible API key is not set for keyRef "${keyRef}". ` +
            `Store the key via SecretStorage with the key name "${keyRef}" before building providers.`,
        )
      }
      return new OpenAICompatibleExtractionProvider({ apiKey, baseUrl, model, displayName })
    }

    case 'azure-openai': {
      const { endpoint, deployment, apiVersion, model, keyRef, displayName } = settings.azureOpenAI
      const apiKey = storage.getSecret(keyRef)
      if (apiKey === null) {
        throw new Error(
          `Azure OpenAI API key is not set for keyRef "${keyRef}". ` +
            `Store the key via SecretStorage with the key name "${keyRef}" before building providers.`,
        )
      }
      return new AzureOpenAIExtractionProvider({
        apiKey,
        endpoint,
        deployment,
        apiVersion,
        model,
        displayName,
      })
    }
  }
}
