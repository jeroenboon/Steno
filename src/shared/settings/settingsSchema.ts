/**
 * AppSettings — Zod schema for persisted settings (item 0012).
 *
 * What lives here:
 *   - Selected ASR provider and extraction provider
 *   - Model IDs for Anthropic (rolling + final pass)
 *   - Language options per provider
 *   - Primary meeting language (default Dutch, per CONTEXT.md)
 *   - Custom OpenAI-compatible endpoint config (base URL, model, keyRef, display name)
 *
 * What does NOT live here:
 *   - API keys (those are in Electron safeStorage, accessed via SecretStorage)
 *   - Meeting data (that is in SQLite via the repos)
 *
 * ## Custom OpenAI-compatible endpoint
 *
 * `customOpenAI.keyRef` is an opaque identifier used to look up the actual key
 * in SecretStorage. The key value itself never appears in this schema or in the
 * JSON file on disk.
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
 * Config for a custom OpenAI-compatible extraction endpoint.
 *
 * `keyRef` is an opaque name used to retrieve the actual API key from
 * SecretStorage. It must not be empty so callers can always look up the key.
 * `displayName` is shown in the egress indicator and disclosure copy.
 */
export const CustomOpenAIConfigSchema = z.object({
  /** Base URL of the OpenAI-compatible API, e.g. https://api.openai.com/v1 */
  baseUrl: z.string().url(),
  /** Model identifier, e.g. gpt-4o */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI and disclosure copy */
  displayName: z.string().min(1),
})

export type CustomOpenAIConfig = z.infer<typeof CustomOpenAIConfigSchema>

// ---------------------------------------------------------------------------
// Top-level schema — discriminated on extractionProvider
// ---------------------------------------------------------------------------

const BaseSettingsSchema = z.object({
  /** Which ASR provider is active. */
  asrProvider: z.enum(['deepgram', 'local-parakeet']),
  /** Primary meeting language (BCP-47). Default 'nl' per CONTEXT.md. */
  primaryLanguage: z.string().min(1),
  /** Anthropic-specific model overrides (optional). */
  anthropic: AnthropicConfigSchema,
  /** Deepgram-specific config (optional). */
  deepgram: DeepgramConfigSchema,
})

/**
 * Settings when using the Anthropic preset extractor.
 * No customOpenAI block is required (or meaningful).
 */
const AnthropicSettingsSchema = BaseSettingsSchema.extend({
  extractionProvider: z.literal('anthropic'),
  customOpenAI: z.undefined().optional(),
})

/**
 * Settings when using a custom OpenAI-compatible extractor.
 * customOpenAI block is required and validated.
 */
const CustomOpenAISettingsSchema = BaseSettingsSchema.extend({
  extractionProvider: z.literal('custom-openai'),
  customOpenAI: CustomOpenAIConfigSchema,
})

export const AppSettingsSchema = z.discriminatedUnion('extractionProvider', [
  AnthropicSettingsSchema,
  CustomOpenAISettingsSchema,
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
