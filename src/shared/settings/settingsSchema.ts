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
  endpoint: z.url(),
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
  baseUrl: z.url(),
  /** Model identifier, e.g. gpt-4o */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw key value */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI and disclosure copy */
  displayName: z.string().min(1),
})

export type OpenAICompatibleConfig = z.infer<typeof OpenAICompatibleConfigSchema>

/**
 * Config for a LOCAL OpenAI-compatible extraction endpoint (LM Studio, Ollama,
 * llama.cpp, or any self-hosted server). Modelled as its own extraction
 * discriminator rather than a preset within `openai-compatible` because its
 * egress is on-device and its API key is optional — the discriminator is what
 * makes `computeEgressState` report `notes: 'local'` cleanly (ADR 0040).
 *
 * `keyRef` is still a required non-empty name so the shared key-resolution stays
 * non-null, but the STORED secret is optional: a keyless local server simply has
 * no secret under that ref, and the factory then omits the Authorization header.
 * `preset` is prefill-only (not egress-load-bearing): the named runtime presets
 * (lmstudio/ollama/llamacpp) plus a generic `local-custom` only prefill the base
 * URL + model in the UI; localness is derived from the base URL host, not here.
 */
export const LocalExtractionConfigSchema = z.object({
  /** Prefill-only runtime preset; localness is derived from the base URL host. */
  preset: z.enum(['lmstudio', 'ollama', 'llamacpp', 'local-custom']).default('local-custom'),
  /** Base URL of the local server, e.g. http://localhost:1234/v1 */
  baseUrl: z.url(),
  /** Model identifier as the local runtime names it. */
  model: z.string().min(1),
  /** Key for SecretStorage lookup — never the raw value. The stored secret is optional. */
  keyRef: z.string().min(1),
  /** Human-readable name shown in the UI. */
  displayName: z.string().min(1),
})

export type LocalExtractionConfig = z.infer<typeof LocalExtractionConfigSchema>

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
  endpoint: z.url(),
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
// This is 15 combination schemas (3 extraction × 5 ASR). Rather than hand-copy
// the same ~13-line object shape 15 times (audit C9: drift risk grew with each
// vendor), each variant is one declarative `providerVariant(...)` call. The
// builder bakes in the shared shape — the two discriminants, `primaryLanguage`,
// the always-optional `anthropic` model overrides, and all six provider slots
// defaulted to "absent" (`z.undefined().optional()`) — then `.extend()`s the
// one or two slots the chosen providers activate. The result is exactly
// behaviour-preserving: same fields, same optionality, same defaults, same
// `z.infer` per-variant type (`.extend` overrides let the union still narrow on
// `asrProvider` / `extractionProvider`; the characterization tests in
// `settingsSchema.test.ts` lock this).
//
// -------------------------------------------------------------------------
// WIRING CHECKLIST — adding a new ASR or extraction vendor touches all of:
//
//   1. settingsSchema.ts (this file)
//        - add the vendor's `<Vendor>ConfigSchema` + exported `z.infer` type
//        - add its slot const below and the new `providerVariant(...)` rows
//          (one per opposite-axis provider) to the `AppSettingsSchema` union
//   2. src/shared/settings/keyRefs.ts
//        - add a `case` to `resolveAsrKeyRef` / `resolveExtractionKeyRef`
//   3. src/main/settings/providerFactory.ts
//        - add a `case` to `buildAsrProvider` / `buildExtractionProvider`
//          (+ any per-vendor live/import builder helper)
//   4. src/main/settings/connectionTest.ts
//        - add the vendor's connection-test branch
//   5. src/shared/settings/egressState.ts
//        - add a `case` to `computeAudioEgress` / `computeNotesEgress`
//          (disclosure copy in `buildDisclosureCopy` derives from these)
//   6. src/shared/providers/extractionPresets.ts
//        - add a preset entry (extraction vendors only)
//   7. src/renderer/src/screens/settingsValidation.ts
//        - extend the form validation for the new slot
//   8. src/renderer/Settings UI cards
//        - AudioAsrCard.tsx (ASR) / OpenAICompatibleCard.tsx +
//          AzureExtractionCard.tsx (extraction), wired in SettingsScreen.tsx
//   9. src/main/settings/migrationUtils.ts
//        - only if an old on-disk shape needs migrating to the new one
//
// (Grounded by grepping where an existing id such as `deepgram` /
// `azure-openai` appears; keep this list in sync when a spot moves.)
// ---------------------------------------------------------------------------

/**
 * Build one variant of the settings union from an ASR axis-shape and an
 * extraction axis-shape.
 *
 * The base shape carries every field common to all 15 variants, with all six
 * provider slots defaulted to "absent". Each axis-shape carries its own
 * discriminant literal (`asrProvider` / `extractionProvider`) plus the one
 * config slot that provider activates — an empty override for the no-slot
 * providers (`local-parakeet`, `anthropic`). `.extend` overrides keep each
 * variant's `z.infer` precise, so the union still narrows on the discriminants.
 * (Baking the discriminant literal into the concrete axis-shape const is what
 * preserves the narrow `z.literal('deepgram')` type per call.)
 */
function providerVariant<AsrShape extends z.ZodRawShape, ExtShape extends z.ZodRawShape>(
  asrShape: AsrShape,
  extShape: ExtShape,
) {
  return z
    .object({
      primaryLanguage: z.string().min(1),
      anthropic: AnthropicConfigSchema,
      openaiCompatible: z.undefined().optional(),
      azureOpenAI: z.undefined().optional(),
      local: z.undefined().optional(),
      deepgram: z.undefined().optional(),
      openaiAudio: z.undefined().optional(),
      mistralVoxtral: z.undefined().optional(),
      azureSpeech: z.undefined().optional(),
    })
    .extend(extShape)
    .extend(asrShape)
}

// Axis-shapes: the discriminant literal + the config slot each provider
// activates. `local-parakeet` and `anthropic` activate no extra slot (their
// config is either absent or the shared optional `anthropic` block).
const asrLocalParakeet = { asrProvider: z.literal('local-parakeet') }
const asrDeepgram = { asrProvider: z.literal('deepgram'), deepgram: DeepgramConfigSchema }
const asrOpenAIAudio = {
  asrProvider: z.literal('openai-audio'),
  openaiAudio: OpenAIAudioConfigSchema,
}
const asrMistralVoxtral = {
  asrProvider: z.literal('mistral-voxtral'),
  mistralVoxtral: MistralVoxtralConfigSchema,
}
const asrAzureSpeech = {
  asrProvider: z.literal('azure-speech'),
  azureSpeech: AzureSpeechConfigSchema,
}

const extAnthropic = { extractionProvider: z.literal('anthropic') }
const extOpenAICompatible = {
  extractionProvider: z.literal('openai-compatible'),
  openaiCompatible: OpenAICompatibleConfigSchema,
}
const extAzureOpenAI = {
  extractionProvider: z.literal('azure-openai'),
  azureOpenAI: AzureOpenAIConfigSchema,
}
const extLocal = {
  extractionProvider: z.literal('local'),
  local: LocalExtractionConfigSchema,
}

// Enumerated explicitly (not `.map`) so each member keeps its precise
// per-variant `z.infer` type and the array stays a tuple `z.union` accepts.
export const AppSettingsSchema = z.union([
  // Anthropic extraction × each ASR
  providerVariant(asrLocalParakeet, extAnthropic),
  providerVariant(asrDeepgram, extAnthropic),
  providerVariant(asrOpenAIAudio, extAnthropic),
  providerVariant(asrMistralVoxtral, extAnthropic),
  providerVariant(asrAzureSpeech, extAnthropic),
  // OpenAI-compatible extraction × each ASR
  providerVariant(asrLocalParakeet, extOpenAICompatible),
  providerVariant(asrDeepgram, extOpenAICompatible),
  providerVariant(asrOpenAIAudio, extOpenAICompatible),
  providerVariant(asrMistralVoxtral, extOpenAICompatible),
  providerVariant(asrAzureSpeech, extOpenAICompatible),
  // Azure OpenAI extraction × each ASR
  providerVariant(asrLocalParakeet, extAzureOpenAI),
  providerVariant(asrDeepgram, extAzureOpenAI),
  providerVariant(asrOpenAIAudio, extAzureOpenAI),
  providerVariant(asrMistralVoxtral, extAzureOpenAI),
  providerVariant(asrAzureSpeech, extAzureOpenAI),
  // Local extraction × each ASR
  providerVariant(asrLocalParakeet, extLocal),
  providerVariant(asrDeepgram, extLocal),
  providerVariant(asrOpenAIAudio, extLocal),
  providerVariant(asrMistralVoxtral, extLocal),
  providerVariant(asrAzureSpeech, extLocal),
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
