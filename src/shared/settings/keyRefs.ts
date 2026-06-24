/**
 * KeyRef resolution + shared-key detection (Phase 5.2).
 *
 * A keyRef is the opaque SecretStorage name under which a provider's API key is
 * stored (never the key value itself). One vendor key can serve both roles:
 * picking OpenAI for ASR and for extraction means both resolve to keyRef
 * 'openai', so a key entered once satisfies both. These helpers expose that fact
 * so the UI can resolve key presence with one lookup and tell the user that
 * replacing a shared key affects both roles.
 *
 * Pure domain code — no vendor SDKs, no IPC. Mirrors the provider switch in
 * providerFactory / connectionTest so the keyRefs stay in lockstep.
 */

import type { AppSettings } from './settingsSchema'

/** The SecretStorage keyRef the extraction provider uses. Always non-null. */
export function resolveExtractionKeyRef(settings: AppSettings): string {
  switch (settings.extractionProvider) {
    case 'anthropic':
      return 'anthropic'
    case 'openai-compatible':
      return settings.openaiCompatible.keyRef
    case 'azure-openai':
      return settings.azureOpenAI.keyRef
  }
}

/**
 * The SecretStorage keyRef the ASR provider uses, or null when the provider
 * needs no key (the on-device option).
 */
export function resolveAsrKeyRef(settings: AppSettings): string | null {
  switch (settings.asrProvider) {
    case 'local-parakeet':
      return null
    case 'deepgram':
      return 'deepgram'
    case 'openai-audio':
      return settings.openaiAudio.keyRef
    case 'mistral-voxtral':
      return settings.mistralVoxtral.keyRef
    case 'azure-speech':
      return settings.azureSpeech.keyRef
  }
}

/**
 * The keyRef shared by both roles, or null when they differ (or one role needs
 * no key). When non-null, a single stored secret backs both ASR and extraction.
 */
export function getSharedKeyRef(settings: AppSettings): string | null {
  const asr = resolveAsrKeyRef(settings)
  const extraction = resolveExtractionKeyRef(settings)
  return asr !== null && asr === extraction ? asr : null
}
