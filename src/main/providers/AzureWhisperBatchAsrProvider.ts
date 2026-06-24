/**
 * AzureWhisperBatchAsrProvider (Phase 3.3).
 *
 * Import-only ASR adapter for an Azure-hosted Whisper deployment. Azure speaks
 * the same transcription response shape as OpenAI, so it reuses the batch
 * substrate (batchAsrSupport.ts) and the OpenAI-style segment mapping; it only
 * differs in the deployment URL and the `api-key` auth header (mirroring
 * AzureOpenAIExtractionProvider).
 *
 * ## Privacy (principle #12)
 * The API key is injected and travels only in the `api-key` header; it is never
 * logged. Audio and transcript text are never logged.
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

const AzureSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
})

const AzureTranscriptionSchema = z.object({
  text: z.string().optional(),
  segments: z.array(AzureSegmentSchema).optional(),
})

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface AzureWhisperBatchAsrProviderOptions {
  apiKey: string
  /** Azure resource endpoint, e.g. https://my-resource.openai.azure.com/ */
  endpoint: string
  /** Deployment name, e.g. whisper */
  deployment: string
  /** Azure API version, e.g. 2024-06-01 */
  apiVersion: string
  /** Model identifier (for reference / logs). */
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

export class AzureWhisperBatchAsrProvider extends ImportOnlyAsrProvider {
  private readonly _apiKey: string
  private readonly _url: string
  private readonly _model: string
  private readonly _language: string | undefined
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: AzureWhisperBatchAsrProviderOptions) {
    super(`[${opts.displayName} audio]`)
    this._apiKey = opts.apiKey
    const endpoint = opts.endpoint.replace(/\/$/, '')
    this._url =
      `${endpoint}/openai/deployments/${opts.deployment}/audio/transcriptions` +
      `?api-version=${opts.apiVersion}`
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
      target: { url: this._url, headers: { 'api-key': this._apiKey } },
      logTag: this.logTag,
      fetch: this._fetch,
    })

    const parsed = AzureTranscriptionSchema.safeParse(json)
    if (!parsed.success) {
      console.error(`${this.logTag} Transcription response failed validation`)
      throw new Error('Azure transcription response did not match the expected shape')
    }

    return transcriptionResultToSpans(parsed.data)
  }
}
