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

import type { ASRProvider, ExtractionProvider } from '@shared/providers'

import {
  AnthropicExtractionProvider,
  type AnthropicExtractionProviderOptions,
} from '../providers/AnthropicExtractionProvider'
import { CustomOpenAIExtractionProvider } from '../providers/CustomOpenAIExtractionProvider'
import { DeepgramAsrProvider } from '../providers/DeepgramAsrProvider'

import type { SecretStorage } from './SecretStorage'
import type { AppSettings } from './settingsSchema'

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface BuiltProviders {
  asr: ASRProvider
  extraction: ExtractionProvider
}

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

// ---------------------------------------------------------------------------
// ASR provider construction
// ---------------------------------------------------------------------------

function buildAsrProvider(settings: AppSettings, storage: SecretStorage): ASRProvider {
  switch (settings.asrProvider) {
    case 'local-parakeet':
      throw new Error(
        'ASR provider "local-parakeet" is not yet implemented. ' +
          'It will be available in item 0023. Select "deepgram" in settings to continue.',
      )

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

    case 'custom-openai': {
      const { baseUrl, model, keyRef, displayName } = settings.customOpenAI
      const apiKey = storage.getSecret(keyRef)
      if (apiKey === null) {
        throw new Error(
          `Custom OpenAI API key is not set for keyRef "${keyRef}". ` +
            `Store the key via SecretStorage with the key name "${keyRef}" before building providers.`,
        )
      }
      return new CustomOpenAIExtractionProvider({ apiKey, baseUrl, model, displayName })
    }
  }
}
