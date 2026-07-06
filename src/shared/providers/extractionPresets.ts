/**
 * Preset catalog for extraction providers (Phase 1.1).
 *
 * Maps vendor presets ('openai', 'mistral', 'custom') to their default configurations.
 * This is data-only; no adapter logic. Phase 1.2 will wire this into the settings form.
 */

export const extractionPresets = {
  openai: {
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  mistral: {
    displayName: 'Mistral',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-medium-3.5',
  },
  custom: {
    displayName: 'Custom',
    defaultBaseUrl: '',
    defaultModel: '',
  },
} as const

/**
 * Preset catalog for the LOCAL extraction provider (ADR 0040).
 *
 * The three named runtimes all speak the OpenAI-compatible protocol and differ
 * only in default port and example model; picking one prefills the base URL +
 * model in the local settings card. `local-custom` is the generic entry (empty
 * base URL) for anything else self-hosted (vLLM, LocalAI, TGI, ...).
 *
 * Presets are PREFILL-ONLY and NOT egress-load-bearing: `computeEgressState`
 * derives localness from the configured base URL host, never from the preset.
 * LM Studio is listed first per the primary local workflow.
 */
export const localExtractionPresets = {
  lmstudio: {
    displayName: 'LM Studio',
    defaultBaseUrl: 'http://localhost:1234/v1',
    // LM Studio serves whatever model is loaded; the user names it on the card.
    defaultModel: '',
  },
  ollama: {
    displayName: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
  },
  llamacpp: {
    displayName: 'llama.cpp',
    defaultBaseUrl: 'http://localhost:8080/v1',
    defaultModel: 'local-model',
  },
  'local-custom': {
    displayName: 'Aangepast',
    defaultBaseUrl: '',
    defaultModel: '',
  },
} as const

/** The local runtime presets, prefill-only (see {@link localExtractionPresets}). */
export type LocalPreset = keyof typeof localExtractionPresets
