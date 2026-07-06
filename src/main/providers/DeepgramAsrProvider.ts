/**
 * DeepgramAsrProvider (item 0011).
 *
 * Real streaming cloud ASR adapter behind the ASRProvider port, using
 * Deepgram's realtime WebSocket API directly (no @deepgram/sdk dependency).
 *
 * ## Design decisions (see ADR 0011)
 *
 * ### Raw WebSocket over the Deepgram SDK
 * Injecting a WebSocketFactory makes the transport boundary fully mockable in
 * tests without having to fake an entire SDK object graph. The Deepgram
 * realtime API is a well-documented WebSocket protocol; the SDK is a thin
 * convenience layer over it. Staying raw keeps deps minimal and tests clean.
 *
 * ### Shared transport plumbing
 * The generic realtime machinery (span queue + async-iterator, reconnect with
 * backoff, frame decode) lives in {@link RealtimeSpanStream}. This adapter is
 * the Deepgram {@link RealtimeAsrWire}: it supplies the connection (URL + token
 * subprotocol), the raw-frame encoding, and the Results -> TranscriptSpan parse.
 *
 * ### Interim + final spans
 * Deepgram emits `is_final=false` (interim) results as text stabilises, then
 * `is_final=true` once it commits. We emit both kinds as TranscriptSpan with
 * `isFinal` set accordingly. Consumers (the extraction loop) must filter to
 * `isFinal === true` (or `isFinal !== false`). See ADR 0011 for the rationale.
 *
 * ### Reconnect / backoff
 * On socket close or error the stream reconnects with exponential backoff
 * (1s -> 2s -> 4s -> ... -> maxBackoffMs). The `sleep` function is injected so
 * tests can resolve it instantly with no real timer waits. The session
 * (in-progress span queue and iterator) survives across reconnects.
 *
 * ### Privacy (principle #12)
 * The API key appears only in the WebSocket subprotocol, never in any log line.
 * Audio frames, transcript text, and raw payloads are never logged.
 */

import { randomUUID } from 'node:crypto'

import WebSocketImpl from 'ws'
import { z } from 'zod'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import type { ASRProvider, AsrTerminalState } from '@shared/providers'

import {
  RealtimeSpanStream,
  type RealtimeAsrWire,
  type RealtimeSpanStreamOptions,
  type WebSocketLike,
} from './realtimeSpanStream'

// Re-export so existing importers (and tests) can keep sourcing the WebSocket
// surface from here; the canonical definition now lives in RealtimeSpanStream.
export type { WebSocketLike }

// ---------------------------------------------------------------------------
// Deepgram WebSocket URL helpers
// ---------------------------------------------------------------------------

const DEEPGRAM_WSS_BASE = 'wss://api.deepgram.com/v1/listen'

function buildDeepgramUrl(language: string): string {
  const params = new URLSearchParams({
    language,
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    diarize: 'true',
    interim_results: 'true',
  })
  // Auth is via the 'token' WebSocket subprotocol (see the wire's connect), NOT
  // a query param — Deepgram rejects query-param auth, which closed the socket
  // immediately and triggered an endless reconnect loop.
  return `${DEEPGRAM_WSS_BASE}?${params.toString()}`
}

const DEEPGRAM_REST_BASE = 'https://api.deepgram.com/v1/listen'

/** URL for the prerecorded (batch) REST API used by the file-import path. */
function buildDeepgramRestUrl(language: string): string {
  const params = new URLSearchParams({
    language,
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    diarize: 'true',
    punctuate: 'true',
    utterances: 'true',
  })
  return `${DEEPGRAM_REST_BASE}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Deepgram response payload schema (Zod at the boundary — principle #8)
// ---------------------------------------------------------------------------

const DeepgramWordSchema = z.object({
  word: z.string(),
  speaker: z.number().optional(),
})

const DeepgramAlternativeSchema = z.object({
  transcript: z.string(),
  confidence: z.number().optional(),
  words: z.array(DeepgramWordSchema).optional(),
})

const DeepgramResultSchema = z.object({
  type: z.literal('Results'),
  channel: z.object({
    alternatives: z.array(DeepgramAlternativeSchema).min(1),
  }),
  is_final: z.boolean(),
  start: z.number(),
  duration: z.number(),
})

type DeepgramResult = z.infer<typeof DeepgramResultSchema>

// Prerecorded (batch) REST response — only the fields the import path needs.
const DeepgramPrerecordedSchema = z.object({
  metadata: z.object({ duration: z.number().optional() }).optional(),
  results: z.object({
    channels: z
      .array(
        z.object({
          alternatives: z
            .array(z.object({ transcript: z.string(), confidence: z.number().optional() }))
            .min(1),
        }),
      )
      .optional(),
    utterances: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
          transcript: z.string(),
          confidence: z.number().optional(),
          speaker: z.number().optional(),
        }),
      )
      .optional(),
  }),
})

type DeepgramPrerecorded = z.infer<typeof DeepgramPrerecordedSchema>

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Factory that produces a WebSocket-compatible instance. Injected for
 * testability. `protocols` carries the Deepgram auth subprotocol
 * (['token', apiKey]); both the browser WebSocket and the `ws` package accept
 * it as the second constructor argument.
 */
export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike

export interface DeepgramAsrProviderOptions {
  /** Deepgram API key. Injected; never read from disk here (secrets = item 0012). */
  apiKey: string
  /** BCP-47 language tag, e.g. 'nl' or 'en'. Default 'nl'. */
  language?: string
  /**
   * Async sleep function, injected for deterministic tests.
   * Defaults to a real `setTimeout`-based sleep in production.
   */
  sleep?: (ms: number) => Promise<void>
  /** Maximum backoff delay in milliseconds. Default 30 000 ms. */
  maxBackoffMs?: number
  /**
   * WebSocket factory. Injected for tests; defaults to the Node `ws` package,
   * because the Electron main process has no global WebSocket.
   */
  webSocketFactory?: WebSocketFactory
  /**
   * Fetch implementation for the prerecorded (batch) REST call used by
   * transcribeBatch. Injected for tests; defaults to the global fetch.
   */
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DeepgramAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _language: string
  private readonly _fetch: typeof globalThis.fetch
  private readonly _stream: RealtimeSpanStream
  /** Terminal-state observer registered via onTerminal(); undefined until set. */
  private _onTerminal: ((state: AsrTerminalState) => void) | undefined = undefined

  constructor(options: DeepgramAsrProviderOptions) {
    this._apiKey = options.apiKey
    this._language = options.language ?? 'nl'
    this._fetch = options.fetch ?? globalThis.fetch

    const wsFactory: WebSocketFactory =
      options.webSocketFactory ??
      ((url, protocols) => new WebSocketImpl(url, protocols) as unknown as WebSocketLike)

    const wire: RealtimeAsrWire = {
      name: 'DeepgramAsrProvider',
      connect: () => wsFactory(buildDeepgramUrl(this._language), ['token', this._apiKey]),
      // Deepgram configures everything via the URL; no session-config message,
      // and audio is sent as raw linear16 frames.
      encodeFrame: (chunk) => chunk,
      parseMessage: (message) => {
        const result = DeepgramResultSchema.safeParse(message)
        if (!result.success) return []
        const span = toTranscriptSpan(result.data)
        return span === null ? [] : [span]
      },
    }

    // Forward the stream's terminal state out through the port. The stream owns
    // the auth/max-retries classification; the adapter only relays it to whoever
    // registered via onTerminal() (the runtime).
    const streamOptions: RealtimeSpanStreamOptions = {
      onTerminal: (state) => this._onTerminal?.(state),
    }
    if (options.sleep !== undefined) streamOptions.sleep = options.sleep
    if (options.maxBackoffMs !== undefined) streamOptions.maxBackoffMs = options.maxBackoffMs
    this._stream = new RealtimeSpanStream(wire, streamOptions)
  }

  /** Register the terminal-state observer (ASRProvider port, audit C4). */
  onTerminal(cb: (state: AsrTerminalState) => void): void {
    this._onTerminal = cb
  }

  // -------------------------------------------------------------------------
  // ASRProvider interface — realtime path delegates to the shared stream
  // -------------------------------------------------------------------------

  start(): void {
    this._stream.start()
  }

  stop(): void {
    this._stream.stop()
  }

  pushAudioFrame(chunk: Uint8Array): void {
    this._stream.pushAudioFrame(chunk)
  }

  spans(): AsyncIterable<TranscriptSpan> {
    return this._stream.spans()
  }

  // -------------------------------------------------------------------------
  // Prerecorded (batch) REST — file-import path (item 0026)
  // -------------------------------------------------------------------------

  /**
   * Transcribe a complete PCM buffer via Deepgram's prerecorded REST API
   * (item 0026 — file import). No realtime socket: one HTTP POST of the raw
   * linear16 audio, then map the returned utterances (or the channel transcript
   * as a fallback) to final spans.
   *
   * Throws on a non-ok HTTP response or a response that fails validation, so the
   * import surfaces the failure instead of silently producing an empty
   * transcript. Never logs the key, audio, or transcript (principle #12).
   */
  async transcribeBatch(pcm: Uint8Array): Promise<TranscriptSpan[]> {
    const response = await this._fetch(buildDeepgramRestUrl(this._language), {
      method: 'POST',
      headers: {
        Authorization: `Token ${this._apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      // The PCM bytes are a valid fetch body; cast past the ArrayBufferLike
      // generic mismatch between the Uint8Array and the DOM BodyInit type.
      body: pcm as unknown as BodyInit,
    })

    if (!response.ok) {
      console.error(
        `[DeepgramAsrProvider] Prerecorded request failed (HTTP ${String(response.status)})`,
      )
      throw new Error(`Deepgram prerecorded request failed with status ${String(response.status)}`)
    }

    const json: unknown = await response.json()
    const parsed = DeepgramPrerecordedSchema.safeParse(json)
    if (!parsed.success) {
      console.error('[DeepgramAsrProvider] Prerecorded response failed validation')
      throw new Error('Deepgram prerecorded response did not match the expected shape')
    }

    return prerecordedToSpans(parsed.data)
  }
}

// ---------------------------------------------------------------------------
// Deepgram Results payload -> TranscriptSpan
// ---------------------------------------------------------------------------

function toTranscriptSpan(result: DeepgramResult): TranscriptSpan | null {
  const alt = result.channel.alternatives[0]
  if (alt === undefined) return null

  const transcript = alt.transcript.trim()
  if (transcript.length === 0) return null

  // Resolve speaker label from the first word's speaker field.
  const firstWord = alt.words?.[0]
  const speakerLabel =
    firstWord?.speaker !== undefined ? `Speaker ${String(firstWord.speaker)}` : undefined

  const raw = {
    id: randomUUID(),
    text: transcript,
    startMs: Math.round(result.start * 1000),
    endMs: Math.round((result.start + result.duration) * 1000),
    confidence: alt.confidence,
    speakerLabel,
    isFinal: result.is_final,
  }

  // Validate through the shared Zod schema (principle #8).
  const parsed = TranscriptSpanSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Prerecorded response -> spans
// ---------------------------------------------------------------------------

function prerecordedToSpans(data: DeepgramPrerecorded): TranscriptSpan[] {
  const spans: TranscriptSpan[] = []

  const utterances = data.results.utterances
  if (utterances !== undefined && utterances.length > 0) {
    for (const u of utterances) {
      const text = u.transcript.trim()
      if (text.length === 0) continue
      const raw = {
        id: randomUUID(),
        text,
        startMs: Math.round(u.start * 1000),
        endMs: Math.round(u.end * 1000),
        confidence: u.confidence,
        speakerLabel: u.speaker !== undefined ? `Speaker ${String(u.speaker)}` : undefined,
        isFinal: true,
      }
      const parsed = TranscriptSpanSchema.safeParse(raw)
      if (parsed.success) spans.push(parsed.data)
    }
    return spans
  }

  // Fallback: no utterances — use the channel transcript as a single span.
  const alt = data.results.channels?.[0]?.alternatives[0]
  if (alt !== undefined) {
    const text = alt.transcript.trim()
    if (text.length > 0) {
      const raw = {
        id: randomUUID(),
        text,
        startMs: 0,
        endMs: Math.round((data.metadata?.duration ?? 0) * 1000),
        confidence: alt.confidence,
        isFinal: true,
      }
      const parsed = TranscriptSpanSchema.safeParse(raw)
      if (parsed.success) spans.push(parsed.data)
    }
  }

  return spans
}
