/**
 * MistralVoxtralBatchAsrProvider (Phase 3.2).
 *
 * Import-only ASR adapter for Mistral's Voxtral transcription (Voxtral Mini
 * Transcribe by default). It shares the WAV/multipart/POST substrate and the
 * import-only streaming throws with the other batch adapters (batchAsrSupport.ts)
 * and only supplies the Mistral target (Bearer auth) and Voxtral's response
 * mapping.
 *
 * Voxtral returns speaker diarization, which maps onto the TranscriptSpan
 * `speakerLabel` field so the existing Speaker-label → Participant flow
 * (CONTEXT.md) lights up on the import path. A nice free win on Mistral.
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

const VoxtralSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  /** Diarization speaker, numeric or string id; absent when not diarized. */
  speaker: z.union([z.number(), z.string()]).optional(),
})

const VoxtralTranscriptionSchema = z.object({
  text: z.string().optional(),
  segments: z.array(VoxtralSegmentSchema).optional(),
})

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface MistralVoxtralBatchAsrProviderOptions {
  apiKey: string
  /** Base URL, e.g. https://api.mistral.ai/v1 */
  baseUrl: string
  /** Model identifier, e.g. voxtral-mini-2507 */
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

export class MistralVoxtralBatchAsrProvider extends ImportOnlyAsrProvider {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _model: string
  private readonly _language: string | undefined
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: MistralVoxtralBatchAsrProviderOptions) {
    super(`[${opts.displayName} audio]`)
    this._apiKey = opts.apiKey
    this._baseUrl = opts.baseUrl.replace(/\/$/, '')
    this._model = opts.model
    this._language = opts.language
    this._fetch = opts.fetch ?? globalThis.fetch
  }

  async transcribeBatch(pcm: Uint8Array): Promise<TranscriptSpan[]> {
    const formFields: Record<string, string> = { model: this._model }
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

    const parsed = VoxtralTranscriptionSchema.safeParse(json)
    if (!parsed.success) {
      console.error(`${this.logTag} Transcription response failed validation`)
      throw new Error('Mistral transcription response did not match the expected shape')
    }

    return transcriptionResultToSpans(parsed.data)
  }
}
