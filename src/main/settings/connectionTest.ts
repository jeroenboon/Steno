/**
 * Provider connection test (Phase 5.1).
 *
 * One cheap auth/reachability round-trip per provider, run at config time so the
 * user sees auth/URL mistakes in Settings instead of discovering them mid-meeting.
 * We chose a lightweight GET against the vendor's models/projects listing over a
 * "tiny transcription": it validates the same things (key is accepted, endpoint
 * resolves) at near-zero cost and without synthesising per-vendor audio.
 *
 * ## Privacy (principle #12)
 * The API key only ever travels inside the request headers. It is never logged,
 * never echoed in the result, and the result string carries only the HTTP status
 * or a generic transport message.
 *
 * ## Why a standalone function and not a provider method?
 * The probe is a config-time concern that cuts across the live/import adapter
 * split (e.g. a cloud-ASR vendor uses a realtime adapter live and a batch adapter
 * for import, but one key serves both). Centralising the probe avoids threading a
 * testConnection() method through every adapter and the realtime/batch variants,
 * and keeps all the URL/auth assembly for the check in one easily tested place.
 */

import type { SecretStorage } from './SecretStorage'
import type { AppSettings } from './settingsSchema'

// ---------------------------------------------------------------------------
// Result + options
// ---------------------------------------------------------------------------

export type ConnectionTestResult = { ok: true } | { ok: false; error: string }

export interface TestProviderConnectionOptions {
  /** Which configured provider to probe. */
  role: 'asr' | 'extraction'
  /** Current persisted settings (carries the provider config + keyRef). */
  settings: AppSettings
  /** Secret storage to resolve the keyRef into the raw key (never returned). */
  storage: SecretStorage
  /** Injected for testability. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Probe description: the resolved URL + a function that builds auth headers
// from the (looked-up) key. Returned by the per-provider resolvers below.
// ---------------------------------------------------------------------------

interface Probe {
  url: string
  keyRef: string
  authHeaders: (key: string) => Record<string, string>
  /**
   * When true, a missing stored secret is not an error: the probe runs
   * unauthenticated. Used by local endpoints, whose key is optional (ADR 0040).
   */
  keyOptional?: boolean
  /**
   * When true, failures are mapped to local-specific hint codes
   * (`local-unreachable` / `local-model-missing` / `local-auth`) so the UI can
   * show concrete troubleshooting copy instead of a bare status (ADR 0040 §5).
   */
  localHints?: boolean
}

const OPENAI_AUDIO_BASE_URL = 'https://api.openai.com/v1'
const MISTRAL_AUDIO_BASE_URL = 'https://api.mistral.ai/v1'

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function testProviderConnection(
  opts: TestProviderConnectionOptions,
): Promise<ConnectionTestResult> {
  const probe =
    opts.role === 'extraction'
      ? resolveExtractionProbe(opts.settings)
      : resolveAsrProbe(opts.settings)

  if (probe === null) {
    return { ok: false, error: 'unsupported' }
  }

  const key = opts.storage.getSecret(probe.keyRef)
  if (key === null && probe.keyOptional !== true) {
    return { ok: false, error: 'no-key' }
  }

  // A keyless (optional-key) probe runs unauthenticated; otherwise attach auth.
  const headers = key === null ? {} : probe.authHeaders(key)

  const doFetch = opts.fetch ?? globalThis.fetch
  try {
    const response = await doFetch(probe.url, {
      method: 'GET',
      headers,
    })
    if (response.ok) return { ok: true }
    if (probe.localHints === true) {
      // Concrete hints for a local runtime the user can fix (ADR 0040 §5):
      // 404 → the requested model is not loaded; 401/403 → the server wants a
      // key. Anything else keeps the generic status.
      if (response.status === 404) return { ok: false, error: 'local-model-missing' }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'local-auth' }
      }
    }
    return { ok: false, error: `HTTP ${String(response.status)}` }
  } catch {
    // Never surface the underlying error object — it could echo the URL/key.
    // For a local runtime the most likely cause is "server not running / wrong
    // port", so give that hint instead of the generic transport code.
    if (probe.localHints === true) return { ok: false, error: 'local-unreachable' }
    return { ok: false, error: 'network' }
  }
}

// ---------------------------------------------------------------------------
// Per-provider probe resolution
// ---------------------------------------------------------------------------

// Azure data-plane model listing default api-version (azure-speech leaves it
// optional; the extraction branch always carries a concrete one).
const DEFAULT_AZURE_API_VERSION = '2024-06-01'

function azureModelsUrl(endpoint: string, apiVersion: string): string {
  const base = endpoint.replace(/\/$/, '')
  return `${base}/openai/models?api-version=${apiVersion}`
}

function apiKeyHeaders(key: string): Record<string, string> {
  return { 'api-key': key }
}

function resolveExtractionProbe(settings: AppSettings): Probe | null {
  switch (settings.extractionProvider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        keyRef: 'anthropic',
        authHeaders: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
      }
    case 'openai-compatible': {
      const cfg = settings.openaiCompatible
      const baseUrl = cfg.baseUrl.replace(/\/$/, '')
      return { url: `${baseUrl}/models`, keyRef: cfg.keyRef, authHeaders: bearer }
    }
    case 'azure-openai': {
      const cfg = settings.azureOpenAI
      return {
        url: azureModelsUrl(cfg.endpoint, cfg.apiVersion),
        keyRef: cfg.keyRef,
        authHeaders: apiKeyHeaders,
      }
    }
    case 'local': {
      // Local OpenAI-compatible server: probe /models, unauthenticated when no
      // key is stored (Bearer only if the user set one). `localHints` maps
      // failures to concrete troubleshooting codes (ADR 0040 §5).
      const cfg = settings.local
      const baseUrl = cfg.baseUrl.replace(/\/$/, '')
      return {
        url: `${baseUrl}/models`,
        keyRef: cfg.keyRef,
        authHeaders: bearer,
        keyOptional: true,
        localHints: true,
      }
    }
  }
}

function resolveAsrProbe(settings: AppSettings): Probe | null {
  switch (settings.asrProvider) {
    case 'deepgram':
      return {
        url: 'https://api.deepgram.com/v1/projects',
        keyRef: 'deepgram',
        authHeaders: (key) => ({ Authorization: `Token ${key}` }),
      }
    case 'openai-audio': {
      const cfg = settings.openaiAudio
      return { url: `${OPENAI_AUDIO_BASE_URL}/models`, keyRef: cfg.keyRef, authHeaders: bearer }
    }
    case 'mistral-voxtral': {
      const cfg = settings.mistralVoxtral
      return { url: `${MISTRAL_AUDIO_BASE_URL}/models`, keyRef: cfg.keyRef, authHeaders: bearer }
    }
    case 'azure-speech': {
      const cfg = settings.azureSpeech
      return {
        url: azureModelsUrl(cfg.endpoint, cfg.apiVersion ?? DEFAULT_AZURE_API_VERSION),
        keyRef: cfg.keyRef,
        authHeaders: apiKeyHeaders,
      }
    }
    // local-parakeet runs on-device; there is nothing to probe.
    case 'local-parakeet':
      return null
  }
}
