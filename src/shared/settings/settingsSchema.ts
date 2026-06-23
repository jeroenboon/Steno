/**
 * AppSettings — Zod schema for persisted settings (item 0012, extended for phase 0.1).
 *
 * What lives here:
 *   - Selected ASR provider and extraction provider
 *   - Model IDs for Anthropic (rolling + final pass)
 *   - Language options per provider
 *   - Primary meeting language (default Dutch, per CONTEXT.md)
 *   - OpenAI-compatible endpoint config (base URL, model, preset, keyRef, display name)
 *
 * What does NOT live here:
 *   - API keys (those are in Electron safeStorage, accessed via SecretStorage)
 *   - Meeting data (that is in SQLite via the repos)
 *
 * ## OpenAI-compatible extraction endpoints
 *
 * Supports OpenAI, Mistral, and custom endpoints through a protocol-discriminated
 * union. The `preset` field identifies the vendor (default 'custom' for user-provided
 * endpoints). `keyRef` is an opaque identifier used to look up the actual key in
 * SecretStorage. The key value itself never appears in this schema or in the JSON
 * file on disk.
 *
 * ## local-parakeet
 *
 * The enum includes 'local-parakeet' so the setting is modelled correctly and
 * the egressState can report audio as 'local'. The provider factory will throw
 * "not yet implemented" for this option until item 0023 ships. This is
 * intentional and documented — see ADR 0012.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const AnthropicConfigSchema = z
  .object({
    /** Rolling-turn model. Default: claude-haiku-4-5. */
    rollingModel: z.string().min(1).optional(),
    /** Final-pass model. Default: claude-sonnet-4-6. */
    finalPassModel: z.string().min(1).optional(),
  })
  .optional()

const DeepgramConfigSchema = z
  .object({
    /** BCP-47 language tag, e.g. 'nl'. Defaults to primaryLanguage. */
    language: z.string().min(1).optional(),
  })
  .optional()

/**
 * Config for OpenAI audio ASR (OpenAI or compatible endpoints).
 * Supports gpt-4o-transcribe and gpt-4o-mini-transcribe.
 */
export const OpenAIAudioConfigSchema = z.object({
  /** Model identifier, e.g. gpt-4o-mini-transcribe */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI */
  displayName: z.string().min(1),
  /** BCP-47 language tag (optional). Defaults to primaryLanguage. */
  language: z.string().min(1).optional(),
})

export type OpenAIAudioConfig = z.infer<typeof OpenAIAudioConfigSchema>

/**
 * Config for Mistral Voxtral audio ASR.
 * Supports Voxtral Mini Transcribe and full Voxtral Transcribe.
 */
export const MistralVoxtralConfigSchema = z.object({
  /** Model identifier, e.g. Voxtral Mini Transcribe V2 */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI */
  displayName: z.string().min(1),
  /** BCP-47 language tag (optional). Defaults to primaryLanguage. */
  language: z.string().min(1).optional(),
})

export type MistralVoxtralConfig = z.infer<typeof MistralVoxtralConfigSchema>

/**
 * Config for Azure Speech Services ASR.
 * Requires Azure-specific fields: endpoint, deployment/region, apiVersion.
 */
export const AzureSpeechConfigSchema = z.object({
  /** Azure Speech resource endpoint, e.g. https://my-resource.cognitiveservices.azure.com/ */
  endpoint: z.string().url(),
  /** Azure deployment name or region code, e.g. my-speech-deployment or westeurope */
  deployment: z.string().min(1),
  /** Azure API version (optional) */
  apiVersion: z.string().min(1).optional(),
  /** Model identifier for reference */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI */
  displayName: z.string().min(1),
  /** BCP-47 language tag (optional). Defaults to primaryLanguage. */
  language: z.string().min(1).optional(),
})

export type AzureSpeechConfig = z.infer<typeof AzureSpeechConfigSchema>

/**
 * Config for OpenAI-compatible extraction endpoints (OpenAI, Mistral, or custom).
 * The `preset` distinguishes the vendor/preset (default 'custom' for user-provided).
 *
 * `keyRef` is an opaque name used to retrieve the actual API key from
 * SecretStorage. It must not be empty so callers can always look up the key.
 * `displayName` is shown in the egress indicator and disclosure copy.
 */
export const OpenAICompatibleConfigSchema = z.object({
  /** Preset identifier: 'openai' | 'mistral' | 'custom' (default 'custom') */
  preset: z.enum(['openai', 'mistral', 'custom']).default('custom'),
  /** Base URL of the OpenAI-compatible API, e.g. https://api.openai.com/v1 */
  baseUrl: z.string().url(),
  /** Model identifier, e.g. gpt-4o */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI and disclosure copy */
  displayName: z.string().min(1),
})

export type OpenAICompatibleConfig = z.infer<typeof OpenAICompatibleConfigSchema>

/**
 * Config for Azure OpenAI extraction endpoints.
 * Requires Azure-specific fields: endpoint, deployment, apiVersion, model, keyRef, displayName.
 *
 * `endpoint` is the Azure resource endpoint (e.g. https://my-resource.openai.azure.com/)
 * `deployment` is the deployment name (e.g. my-gpt-4o-deployment)
 * `apiVersion` is the Azure API version (e.g. 2024-12-01-preview)
 * `model` is the model identifier
 * `keyRef` is the key for SecretStorage lookup — never the raw key value
 * `displayName` is shown in the UI and disclosure copy
 */
export const AzureOpenAIConfigSchema = z.object({
  /** Azure OpenAI resource endpoint, e.g. https://my-resource.openai.azure.com/ */
  endpoint: z.string().url(),
  /** Azure OpenAI deployment name, e.g. my-gpt-4o-deployment */
  deployment: z.string().min(1),
  /** Azure API version, e.g. 2024-12-01-preview */
  apiVersion: z.string().min(1),
  /** Model identifier for reference */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI and disclosure copy */
  displayName: z.string().min(1),
})

export type AzureOpenAIConfig = z.infer<typeof AzureOpenAIConfigSchema>

/**
 * Legacy schema for old custom-openai configs (for migration purposes).
 * Matches the old schema shape so we can detect and migrate it.
 */
export const CustomOpenAIConfigSchema = OpenAICompatibleConfigSchema.omit({ preset: true })
export type CustomOpenAIConfig = z.infer<typeof CustomOpenAIConfigSchema>

// ---------------------------------------------------------------------------
// Combined Settings Schemas
// -------------------------
//
// The AppSettings schema is a union of all valid combinations of extraction
// providers (Anthropic, OpenAI-compatible, Azure OpenAI) and ASR providers
// (local-parakeet, Deepgram, OpenAI Audio, Mistral Voxtral, Azure Speech).
//
// This generates 15 combination schemas (3 extraction × 5 ASR), each with
// explicit type definitions to ensure type safety and proper validation.
// ---------------------------------------------------------------------------

/**
 * Settings when using the Anthropic preset extractor with local Parakeet ASR.
 */
const AnthropicLocalParakeetSchema = z.object({
  asrProvider: z.literal('local-parakeet'),
  extractionProvider: z.literal('anthropic'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using the Anthropic preset extractor with Deepgram ASR.
 */
const AnthropicDeepgramSchema = z.object({
  asrProvider: z.literal('deepgram'),
  extractionProvider: z.literal('anthropic'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: z.undefined().optional(),
  deepgram: DeepgramConfigSchema,
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using the Anthropic preset extractor with OpenAI Audio ASR.
 */
const AnthropicOpenAIAudioSchema = z.object({
  asrProvider: z.literal('openai-audio'),
  extractionProvider: z.literal('anthropic'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: OpenAIAudioConfigSchema,
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using the Anthropic preset extractor with Mistral Voxtral ASR.
 */
const AnthropicMistralVoxtralSchema = z.object({
  asrProvider: z.literal('mistral-voxtral'),
  extractionProvider: z.literal('anthropic'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: MistralVoxtralConfigSchema,
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using the Anthropic preset extractor with Azure Speech ASR.
 */
const AnthropicAzureSpeechSchema = z.object({
  asrProvider: z.literal('azure-speech'),
  extractionProvider: z.literal('anthropic'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: AzureSpeechConfigSchema,
})

/**
 * Settings when using an OpenAI-compatible extractor with local Parakeet ASR.
 */
const OpenAICompatibleLocalParakeetSchema = z.object({
  asrProvider: z.literal('local-parakeet'),
  extractionProvider: z.literal('openai-compatible'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: OpenAICompatibleConfigSchema,
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using an OpenAI-compatible extractor with Deepgram ASR.
 */
const OpenAICompatibleDeepgramSchema = z.object({
  asrProvider: z.literal('deepgram'),
  extractionProvider: z.literal('openai-compatible'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: OpenAICompatibleConfigSchema,
  azureOpenAI: z.undefined().optional(),
  deepgram: DeepgramConfigSchema,
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using an OpenAI-compatible extractor with OpenAI Audio ASR.
 */
const OpenAICompatibleOpenAIAudioSchema = z.object({
  asrProvider: z.literal('openai-audio'),
  extractionProvider: z.literal('openai-compatible'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: OpenAICompatibleConfigSchema,
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: OpenAIAudioConfigSchema,
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using an OpenAI-compatible extractor with Mistral Voxtral ASR.
 */
const OpenAICompatibleMistralVoxtralSchema = z.object({
  asrProvider: z.literal('mistral-voxtral'),
  extractionProvider: z.literal('openai-compatible'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: OpenAICompatibleConfigSchema,
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: MistralVoxtralConfigSchema,
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using an OpenAI-compatible extractor with Azure Speech ASR.
 */
const OpenAICompatibleAzureSpeechSchema = z.object({
  asrProvider: z.literal('azure-speech'),
  extractionProvider: z.literal('openai-compatible'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: OpenAICompatibleConfigSchema,
  azureOpenAI: z.undefined().optional(),
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: AzureSpeechConfigSchema,
})

/**
 * Settings when using Azure OpenAI extraction with local Parakeet ASR.
 */
const AzureOpenAILocalParakeetSchema = z.object({
  asrProvider: z.literal('local-parakeet'),
  extractionProvider: z.literal('azure-openai'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: AzureOpenAIConfigSchema,
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using Azure OpenAI extraction with Deepgram ASR.
 */
const AzureOpenAIDeepgramSchema = z.object({
  asrProvider: z.literal('deepgram'),
  extractionProvider: z.literal('azure-openai'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: AzureOpenAIConfigSchema,
  deepgram: DeepgramConfigSchema,
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using Azure OpenAI extraction with OpenAI Audio ASR.
 */
const AzureOpenAIOpenAIAudioSchema = z.object({
  asrProvider: z.literal('openai-audio'),
  extractionProvider: z.literal('azure-openai'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: AzureOpenAIConfigSchema,
  deepgram: z.undefined().optional(),
  openaiAudio: OpenAIAudioConfigSchema,
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using Azure OpenAI extraction with Mistral Voxtral ASR.
 */
const AzureOpenAIMistralVoxtralSchema = z.object({
  asrProvider: z.literal('mistral-voxtral'),
  extractionProvider: z.literal('azure-openai'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: AzureOpenAIConfigSchema,
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: MistralVoxtralConfigSchema,
  azureSpeech: z.undefined().optional(),
})

/**
 * Settings when using Azure OpenAI extraction with Azure Speech ASR.
 */
const AzureOpenAIAzureSpeechSchema = z.object({
  asrProvider: z.literal('azure-speech'),
  extractionProvider: z.literal('azure-openai'),
  primaryLanguage: z.string().min(1),
  anthropic: AnthropicConfigSchema,
  openaiCompatible: z.undefined().optional(),
  azureOpenAI: AzureOpenAIConfigSchema,
  deepgram: z.undefined().optional(),
  openaiAudio: z.undefined().optional(),
  mistralVoxtral: z.undefined().optional(),
  azureSpeech: AzureSpeechConfigSchema,
})

export const AppSettingsSchema = z.union([
  AnthropicLocalParakeetSchema,
  AnthropicDeepgramSchema,
  AnthropicOpenAIAudioSchema,
  AnthropicMistralVoxtralSchema,
  AnthropicAzureSpeechSchema,
  OpenAICompatibleLocalParakeetSchema,
  OpenAICompatibleDeepgramSchema,
  OpenAICompatibleOpenAIAudioSchema,
  OpenAICompatibleMistralVoxtralSchema,
  OpenAICompatibleAzureSpeechSchema,
  AzureOpenAILocalParakeetSchema,
  AzureOpenAIDeepgramSchema,
  AzureOpenAIOpenAIAudioSchema,
  AzureOpenAIMistralVoxtralSchema,
  AzureOpenAIAzureSpeechSchema,
])

export type AppSettings = z.infer<typeof AppSettingsSchema>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default settings: cloud Deepgram ASR + Anthropic extraction, Dutch language.
 * Per ADR 0003: the most private viable option is the default where there is a
 * choice. Cloud extraction is V1's only extraction option, so it is the default.
 * ASR defaults to Deepgram (reliable cloud) since local-parakeet is item 0023.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  asrProvider: 'deepgram',
  extractionProvider: 'anthropic',
  primaryLanguage: 'nl',
}
