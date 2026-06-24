/**
 * Azure OpenAI realtime ASR (Phase 4.2).
 *
 * Azure OpenAI speaks the same Realtime transcription protocol as OpenAI, so
 * there is no separate adapter class (ADR 0028: ASR has no shared *wire* across
 * vendors, but Azure shares OpenAI's). This module is a thin factory that builds
 * an OpenAIRealtimeAsrProvider with an Azure connection: the deployment
 * WebSocket URL and the `api-key` auth header (mirroring
 * AzureOpenAIExtractionProvider / AzureWhisperBatchAsrProvider). All session
 * configuration, frame parsing, span mapping and reconnect logic are reused.
 *
 * ## Privacy (principle #12)
 * The API key travels only in the `api-key` header; it is never logged.
 */

import type { Clock } from '@shared/providers'

import {
  OpenAIRealtimeAsrProvider,
  type OpenAIRealtimeAsrProviderOptions,
  type RealtimeConnection,
  type RealtimeWebSocketFactory,
} from './OpenAIRealtimeAsrProvider'

export interface AzureOpenAIRealtimeAsrOptions {
  /** Raw API key for the Azure resource. Injected by the factory. */
  apiKey: string
  /** Azure resource endpoint, e.g. https://my-resource.openai.azure.com/ */
  endpoint: string
  /** Realtime deployment name, e.g. gpt-4o-transcribe */
  deployment: string
  /** Azure API version, e.g. 2024-10-01-preview */
  apiVersion: string
  /** Transcription model id sent in the session config. */
  model?: string
  /** BCP-47 language tag, e.g. 'nl'. */
  language?: string
  /** Async sleep, injected for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
  /** Maximum backoff delay in milliseconds. */
  maxBackoffMs?: number
  /** Clock for span timing, injected for deterministic tests. */
  clock?: Clock
  /** WebSocket factory, injected for tests. */
  webSocketFactory?: RealtimeWebSocketFactory
}

/** Build the Azure realtime deployment WebSocket URL from the resource config. */
function azureRealtimeUrl(endpoint: string, deployment: string, apiVersion: string): string {
  // Strip the trailing slash and switch the scheme to ws(s): https -> wss.
  const base = endpoint.replace(/\/$/, '').replace(/^http/, 'ws')
  const params = new URLSearchParams({
    'api-version': apiVersion,
    deployment,
    intent: 'transcription',
  })
  return `${base}/openai/realtime?${params.toString()}`
}

/**
 * Construct a live realtime ASR provider for an Azure OpenAI deployment. Returns
 * an OpenAIRealtimeAsrProvider wired with the Azure connection (URL + api-key),
 * reusing all of its frame handling.
 */
export function createAzureOpenAIRealtimeAsrProvider(
  opts: AzureOpenAIRealtimeAsrOptions,
): OpenAIRealtimeAsrProvider {
  const url = azureRealtimeUrl(opts.endpoint, opts.deployment, opts.apiVersion)
  const buildConnection = (apiKey: string): RealtimeConnection => ({
    url,
    options: { headers: { 'api-key': apiKey } },
  })

  const providerOpts: OpenAIRealtimeAsrProviderOptions = { apiKey: opts.apiKey, buildConnection }
  if (opts.model !== undefined) providerOpts.model = opts.model
  if (opts.language !== undefined) providerOpts.language = opts.language
  if (opts.sleep !== undefined) providerOpts.sleep = opts.sleep
  if (opts.maxBackoffMs !== undefined) providerOpts.maxBackoffMs = opts.maxBackoffMs
  if (opts.clock !== undefined) providerOpts.clock = opts.clock
  if (opts.webSocketFactory !== undefined) providerOpts.webSocketFactory = opts.webSocketFactory

  return new OpenAIRealtimeAsrProvider(providerOpts)
}
