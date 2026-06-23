/**
 * Provider factory (item 0012).
 *
 * Given validated AppSettings and a SecretStorage instance, constructs and
 * returns the configured ASRProvider and ExtractionProvider.
 *
 * ## Why a factory function?
 * The providers (DeepgramAsrProvider, AnthropicExtractionProvider,
 * CustomOpenAIExtractionProvider) require API keys at construction time. Those
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
import { CustomOpenAIExtractionProvider } from '../providers/CustomOpenAIExtractionProvider'
import { DeepgramAsrProvider } from '../providers/DeepgramAsrProvider'
import { LocalAsrProvider } from '../providers/LocalAsrProvider'
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
  try {
    const providers = buildProviders(settings, storage)
    return { ok: true, providers }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

/**
 * Build ONLY the ASR provider. Gated solely on the ASR key (e.g. Deepgram);
 * indifferent to whether an extraction key is configured. This is what the
 * audio pipeline uses so transcription works as soon as the Deepgram key is set.
 */
export function tryBuildAsrProvider(settings: AppSettings, storage: SecretStorage): BuildAsrResult {
  try {
    return { ok: true, provider: buildAsrProvider(settings, storage) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Build ONLY the extraction provider. Gated solely on its own key
 * (Anthropic or the custom keyRef); indifferent to the ASR key.
 */
export function tryBuildExtractionProvider(
  settings: AppSettings,
  storage: SecretStorage,
): BuildExtractionResult {
  try {
    return { ok: true, provider: buildExtractionProvider(settings, storage) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// ASR provider construction
// ---------------------------------------------------------------------------

function buildAsrProvider(settings: AppSettings, storage: SecretStorage): ASRProvider {
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
      throw new Error(
        'OpenAI audio ASR provider is not yet implemented. ' +
          'Please use Deepgram or local Whisper for now.',
      )
    }

    case 'mistral-voxtral': {
      throw new Error(
        'Mistral Voxtral ASR provider is not yet implemented. ' +
          'Please use Deepgram or local Whisper for now.',
      )
    }

    case 'azure-speech': {
      throw new Error(
        'Azure Speech Services ASR provider is not yet implemented. ' +
          'Please use Deepgram or local Whisper for now.',
      )
    }
  }
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
      return new CustomOpenAIExtractionProvider({ apiKey, baseUrl, model, displayName })
    }

    case 'azure-openai': {
      throw new Error(
        'Azure OpenAI extraction provider is not yet implemented. ' +
          'Please use Anthropic or OpenAI-compatible providers for now.',
      )
    }
  }
}
