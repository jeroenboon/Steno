/**
 * Provider key-help catalog (Phase 5.3).
 *
 * Where the user gets each vendor's API key (and, for Azure, where the
 * endpoint/deployment live). The Settings panels show this at the point of key
 * entry so a first-time user isn't left guessing. Data only — no SDKs, no IPC —
 * keyed by the same vendor keyRefs used by SecretStorage and the factory.
 *
 * URLs are rendered as selectable text, not navigated to from the sandboxed
 * renderer; keeping them here (not hard-coded in the component) means a link
 * refresh is a one-line data edit.
 */

export interface ProviderKeyHelpEntry {
  /** Page where the user creates/copies the API key. */
  keyUrl: string
}

export const PROVIDER_KEY_HELP: Record<string, ProviderKeyHelpEntry> = {
  openai: { keyUrl: 'https://platform.openai.com/api-keys' },
  mistral: { keyUrl: 'https://console.mistral.ai/api-keys' },
  anthropic: { keyUrl: 'https://console.anthropic.com/settings/keys' },
  deepgram: { keyUrl: 'https://console.deepgram.com/' },
  azure: { keyUrl: 'https://portal.azure.com/' },
}
