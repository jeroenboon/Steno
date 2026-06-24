/**
 * OpenAIBatchAsrProvider (Phase 3.1).
 *
 * Import-only ASR adapter behind the ASRProvider port. It implements
 * transcribeBatch against OpenAI's /audio/transcriptions endpoint (gpt-4o-mini-
 * transcribe by default, gpt-4o-transcribe as the quality upgrade) and covers
 * OpenAI plus any custom OpenAI-compatible audio endpoint via baseUrl.
 *
 * The WAV encoding, multipart POST, HTTP-error handling and the streaming
 * "not yet implemented" throws are shared with the other batch adapters via
 * batchAsrSupport.ts; this class only supplies the OpenAI target (Bearer auth)
 * and maps OpenAI's verbose_json response to spans.
 *
 * ## Privacy (principle #12)
 * The API key is injected and travels only in the Authorization header; it is
 * never logged. Audio and transcript text are never logged.
 */

import { z } from 'zod'

import type { TranscriptSpan } from '@shared/domain/types'

import {
  ImportOnlyAsrProvider,
  postAudioTranscription,
  transcriptionResultToSpans,
} from './batchAsrSupport'

// ---------------------------------------------------------------------------
// Response schema (Zod at the boundary — principle #8)
// ---------------------------------------------------------------------------

const OpenAISegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
})

const OpenAITranscriptionSchema = z.object({
  text: z.string().optional(),
  segments: z.array(OpenAISegmentSchema).optional(),
})

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface OpenAIBatchAsrProviderOptions {
  apiKey: string
  /** Base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string
  /** Model identifier, e.g. gpt-4o-mini-transcribe */
  model: string
  /** BCP-47 language tag, e.g. 'nl'. */
  language?: string
  /** Shown in logs (non-sensitive). */
  displayName: string
  /** Injected for testability. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIBatchAsrProvider extends ImportOnlyAsrProvider {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _model: string
  private readonly _language: string | undefined
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: OpenAIBatchAsrProviderOptions) {
    super(`[${opts.displayName} audio]`)
    this._apiKey = opts.apiKey
    this._baseUrl = opts.baseUrl.replace(/\/$/, '')
    this._model = opts.model
    this._language = opts.language
    this._fetch = opts.fetch ?? globalThis.fetch
  }

  async transcribeBatch(pcm: Uint8Array): Promise<TranscriptSpan[]> {
    const formFields: Record<string, string> = {
      model: this._model,
      response_format: 'verbose_json',
    }
    if (this._language !== undefined) formFields.language = this._language

    const json = await postAudioTranscription({
      pcm,
      formFields,
      target: {
        url: `${this._baseUrl}/audio/transcriptions`,
        headers: { Authorization: `Bearer ${this._apiKey}` },
      },
      logTag: this.logTag,
      fetch: this._fetch,
    })

    const parsed = OpenAITranscriptionSchema.safeParse(json)
    if (!parsed.success) {
      console.error(`${this.logTag} Transcription response failed validation`)
      throw new Error('OpenAI transcription response did not match the expected shape')
    }

    return transcriptionResultToSpans(parsed.data)
  }
}
