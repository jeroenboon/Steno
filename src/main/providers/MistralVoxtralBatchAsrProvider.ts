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

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'

import { ImportOnlyAsrProvider, postAudioTranscription } from './batchAsrSupport'

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

    return transcriptionToSpans(parsed.data)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function transcriptionToSpans(data: z.infer<typeof VoxtralTranscriptionSchema>): TranscriptSpan[] {
  const segments = data.segments
  if (segments !== undefined && segments.length > 0) {
    const spans: TranscriptSpan[] = []
    for (const seg of segments) {
      const text = seg.text.trim()
      if (text.length === 0) continue
      const raw: Record<string, unknown> = {
        id: randomUUID(),
        text,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        isFinal: true,
      }
      if (seg.speaker !== undefined) raw.speakerLabel = `Speaker ${String(seg.speaker)}`
      const parsed = TranscriptSpanSchema.safeParse(raw)
      if (parsed.success) spans.push(parsed.data)
    }
    return spans
  }

  // No segments — degrade to a single span over the whole transcript.
  const text = data.text?.trim() ?? ''
  if (text.length === 0) return []
  const parsed = TranscriptSpanSchema.safeParse({
    id: randomUUID(),
    text,
    startMs: 0,
    endMs: 0,
    isFinal: true,
  })
  return parsed.success ? [parsed.data] : []
}
