/**
 * OpenAICompatibleExtractionProvider (items 0012, 0026; generalised in Phase 1.3).
 *
 * An ExtractionProvider adapter for OpenAI-compatible chat-completions endpoints.
 * One wire serves the whole family — OpenAI, Mistral, local proxies, and any
 * generic custom endpoint — because they share the chat-completions request and
 * response shapes. The vendor is just a prefilled base URL + model + displayName
 * (see the preset catalog, extractionPresets.ts); it changes no parsing here.
 *
 * The shared request/parse/validate/retry logic lives in ChatExtractionEngine
 * (openaiChatExtraction.ts), which the Azure adapter reuses too. This adapter
 * only supplies the OpenAI-style target: `${baseUrl}/chat/completions` with an
 * `Authorization: Bearer` header.
 *
 * ## Privacy (principle #12)
 * The API key is injected (never read from disk here). It is passed in the
 * Authorization header and is never logged. Logs are tagged with the
 * (non-sensitive) `displayName` only, so `[OpenAI]` / `[Mistral]` / `[Custom]`
 * are distinguishable without exposing transcript content or the key.
 *
 * ## Constructor params
 * - `apiKey`     — Raw API key for the endpoint. Injected by the factory.
 * - `baseUrl`    — Base URL, e.g. https://api.openai.com/v1
 * - `model`      — Model identifier, e.g. gpt-4o-mini
 * - `displayName` — Shown in logs (non-sensitive) and egress disclosure.
 * - `fetch`       — Injected for testability. Defaults to global fetch.
 */

import type { TranscriptSpan } from '@shared/domain/types'
import type {
  ExtractionProvider,
  ExtractionRequest,
  ExtractionResponse,
  InferredContext,
} from '@shared/providers'

import { ChatExtractionEngine } from './openaiChatExtraction'

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface OpenAICompatibleExtractionProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  displayName: string
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAICompatibleExtractionProvider implements ExtractionProvider {
  private readonly _engine: ChatExtractionEngine

  constructor(opts: OpenAICompatibleExtractionProviderOptions) {
    const baseUrl = opts.baseUrl.replace(/\/$/, '') // strip trailing slash

    this._engine = new ChatExtractionEngine({
      model: opts.model,
      logTag: `[${opts.displayName}]`,
      target: {
        url: `${baseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
      },
      fetch: opts.fetch ?? globalThis.fetch,
    })
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    return this._engine.extract(request)
  }

  /**
   * Infer Agenda Items and Participants from a whole transcript, for an
   * Imported Meeting where the user did not supply them (item 0026). Mirrors
   * extract()'s one-retry-then-empty strategy so a bad response degrades to an
   * empty context rather than throwing into the import.
   */
  async inferContext(spans: TranscriptSpan[]): Promise<InferredContext> {
    return this._engine.inferContext(spans)
  }
}
