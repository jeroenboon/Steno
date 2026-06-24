/**
 * OpenAIBatchAsrProvider (Phase 3.1).
 *
 * Import-only ASR adapter behind the ASRProvider port. It implements
 * transcribeBatch against OpenAI's /audio/transcriptions endpoint (gpt-4o-mini-
 * transcribe by default, gpt-4o-transcribe as the quality upgrade) and covers
 * OpenAI plus any custom OpenAI-compatible audio endpoint via baseUrl.
 *
 * Live ASR for these vendors has no shared realtime wire and is a later phase
 * (see the multi-provider plan), so the streaming methods throw "not yet
 * implemented". The factory gates selecting this provider for a live meeting
 * (Phase 3.4); the import path only ever calls transcribeBatch.
 *
 * ## Wire
 * The renderer hands main raw 16 kHz mono 16-bit LE PCM. OpenAI needs a
 * recognised container, so the PCM is wrapped in a WAV header (wavEncoder.ts)
 * and posted as multipart/form-data with `model` and `response_format`. We ask
 * for verbose_json so the response carries per-segment timing; when a model
 * returns only `text`, the whole transcript degrades to a single span.
 *
 * ## Privacy (principle #12)
 * The API key is injected and travels only in the Authorization header; it is
 * never logged. Audio and transcript text are never logged.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import type { ASRProvider } from '@shared/providers'

import { encodeWav } from './wavEncoder'

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

const SAMPLE_RATE = 16_000
const CHANNELS = 1

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIBatchAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _model: string
  private readonly _language: string | undefined
  private readonly _logTag: string
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: OpenAIBatchAsrProviderOptions) {
    this._apiKey = opts.apiKey
    this._baseUrl = opts.baseUrl.replace(/\/$/, '')
    this._model = opts.model
    this._language = opts.language
    this._logTag = `[${opts.displayName} audio]`
    this._fetch = opts.fetch ?? globalThis.fetch
  }

  async transcribeBatch(pcm: Uint8Array): Promise<TranscriptSpan[]> {
    const wav = encodeWav(pcm, { sampleRate: SAMPLE_RATE, channels: CHANNELS })

    const form = new FormData()
    form.append('model', this._model)
    form.append('response_format', 'verbose_json')
    if (this._language !== undefined) form.append('language', this._language)
    form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'audio.wav')

    const response = await this._fetch(`${this._baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._apiKey}` },
      body: form,
    })

    if (!response.ok) {
      console.error(
        `${this._logTag} Transcription request failed (HTTP ${String(response.status)})`,
      )
      throw new Error(`OpenAI transcription request failed with status ${String(response.status)}`)
    }

    const json: unknown = await response.json()
    const parsed = OpenAITranscriptionSchema.safeParse(json)
    if (!parsed.success) {
      console.error(`${this._logTag} Transcription response failed validation`)
      throw new Error('OpenAI transcription response did not match the expected shape')
    }

    return transcriptionToSpans(parsed.data)
  }

  // -------------------------------------------------------------------------
  // Streaming methods — not yet implemented (live ASR is a later phase)
  // -------------------------------------------------------------------------

  start(): never {
    throw new Error(notYetImplemented(this._logTag))
  }

  stop(): void {
    // No streaming session to close; safe no-op so cleanup paths don't throw.
  }

  pushAudioFrame(): never {
    throw new Error(notYetImplemented(this._logTag))
  }

  spans(): never {
    throw new Error(notYetImplemented(this._logTag))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notYetImplemented(logTag: string): string {
  return `${logTag} live streaming ASR is not yet implemented; this provider supports file import only.`
}

function transcriptionToSpans(data: z.infer<typeof OpenAITranscriptionSchema>): TranscriptSpan[] {
  const segments = data.segments
  if (segments !== undefined && segments.length > 0) {
    const spans: TranscriptSpan[] = []
    for (const seg of segments) {
      const text = seg.text.trim()
      if (text.length === 0) continue
      const parsed = TranscriptSpanSchema.safeParse({
        id: randomUUID(),
        text,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        isFinal: true,
      })
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
