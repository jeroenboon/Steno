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
