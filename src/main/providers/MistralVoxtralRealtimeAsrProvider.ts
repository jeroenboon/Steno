/**
 * MistralVoxtralRealtimeAsrProvider (Phase 4.3).
 *
 * Live streaming cloud ASR adapter behind the ASRProvider port, using Mistral's
 * Voxtral Realtime WebSocket API directly. This is a distinct wire from OpenAI
 * Realtime and Deepgram (ADR 0028: ASR has no shared realtime protocol across
 * vendors), so it is its own {@link RealtimeAsrWire} rather than a reuse.
 *
 * ## Wire
 * - Connect with a Bearer Authorization header.
 * - On open, send a session config message ({ model, language }).
 * - Audio is sent as raw binary PCM frames (no base64 wrapping).
 * - Transcription events come back as JSON:
 *     { type: 'transcript.delta', text }                      -> interim span
 *     { type: 'transcript.final', text, start?, end?, speaker? } -> final span
 *   Voxtral carries diarization, so `speaker` maps onto TranscriptSpan
 *   `speakerLabel` (Speaker N), lighting up the Speaker-label -> Participant flow.
 *   Segment timing uses the event's start/end seconds when present, else the
 *   injected Clock's elapsed time.
 *
 * ## Shared transport plumbing
 * The generic realtime machinery (span queue + async-iterator, reconnect with
 * backoff, frame decode) lives in {@link RealtimeSpanStream}; this adapter only
 * supplies the Voxtral connection, session config, frame encoding and parse.
 *
 * ## Privacy (principle #12)
 * The API key travels only in the connection header; audio, transcript text and
 * raw payloads are never logged — only non-sensitive lifecycle metadata.
 */

import { randomUUID } from 'node:crypto'

import WebSocketImpl from 'ws'
import { z } from 'zod'

import { CAPTURE_SAMPLE_RATE, resamplePcm16 } from '@shared/audio/pcmResampler'
import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import { RealClock, type ASRProvider, type Clock } from '@shared/providers'

import { RealtimeSpanStream, type RealtimeAsrWire, type WebSocketLike } from './realtimeSpanStream'

// ---------------------------------------------------------------------------
// WebSocket abstraction (Bearer header auth — needs header options)
// ---------------------------------------------------------------------------

export interface MistralRealtimeWebSocketOptions {
  headers?: Record<string, string>
}

export type MistralRealtimeWebSocketFactory = (
  url: string,
  options?: MistralRealtimeWebSocketOptions,
) => WebSocketLike

const VOXTRAL_REALTIME_URL = 'wss://api.mistral.ai/v1/audio/transcriptions/realtime'
const DEFAULT_MODEL = 'voxtral-mini-2507'

/**
 * Voxtral Realtime consumes 16 kHz mono pcm16 — the renderer's capture rate — so
 * this is a passthrough today. It is routed through the resampler so a future API
 * revision that wants a different rate is a one-line change to this constant.
 */
const VOXTRAL_REALTIME_SAMPLE_RATE = 16_000

// ---------------------------------------------------------------------------
// Event schemas (Zod at the boundary — principle #8)
// ---------------------------------------------------------------------------

const DeltaEventSchema = z.object({
  type: z.literal('transcript.delta'),
  text: z.string(),
})

const FinalEventSchema = z.object({
  type: z.literal('transcript.final'),
  text: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.union([z.number(), z.string()]).optional(),
})

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface MistralVoxtralRealtimeAsrProviderOptions {
  /** Mistral API key. Injected; never read from disk here. */
  apiKey: string
  /** Voxtral model id, e.g. 'voxtral-mini-2507'. */
  model?: string
  /** BCP-47 language tag, e.g. 'nl'. Default 'nl'. */
  language?: string
  /** Async sleep, injected for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
  /** Maximum backoff delay in milliseconds. Default 30 000 ms. */
  maxBackoffMs?: number
  /** Clock for span timing when an event carries no timestamps. */
  clock?: Clock
  /** WebSocket factory. Injected for tests; defaults to the Node `ws` package. */
  webSocketFactory?: MistralRealtimeWebSocketFactory
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MistralVoxtralRealtimeAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _model: string
  private readonly _language: string
  private readonly _clock: Clock
  private readonly _wsFactory: MistralRealtimeWebSocketFactory
  private readonly _stream: RealtimeSpanStream

  // Per-session span timing, reset on start(); used when an event carries no
  // start/end seconds.
  private _startedAtMs = 0
  private _lastEndMs = 0

  constructor(options: MistralVoxtralRealtimeAsrProviderOptions) {
    this._apiKey = options.apiKey
    this._model = options.model ?? DEFAULT_MODEL
    this._language = options.language ?? 'nl'
    this._clock = options.clock ?? new RealClock()
    this._wsFactory =
      options.webSocketFactory ??
      ((url, opts) =>
        new WebSocketImpl(
          url,
          undefined,
          opts?.headers ? { headers: opts.headers } : undefined,
        ) as unknown as WebSocketLike)

    const wire: RealtimeAsrWire = {
      name: 'MistralVoxtralRealtimeAsrProvider',
      connect: () =>
        this._wsFactory(VOXTRAL_REALTIME_URL, {
          headers: { Authorization: `Bearer ${this._apiKey}` },
        }),
      reset: () => {
        this._startedAtMs = this._clock.now()
        this._lastEndMs = 0
      },
      onOpen: (socket) => {
        socket.send(
          JSON.stringify({ type: 'session.start', model: this._model, language: this._language }),
        )
      },
      encodeFrame: (chunk) =>
        resamplePcm16(chunk, CAPTURE_SAMPLE_RATE, VOXTRAL_REALTIME_SAMPLE_RATE),
      parseMessage: (message) => this._parseMessage(message),
    }

    const streamOptions: { sleep?: (ms: number) => Promise<void>; maxBackoffMs?: number } = {}
    if (options.sleep !== undefined) streamOptions.sleep = options.sleep
    if (options.maxBackoffMs !== undefined) streamOptions.maxBackoffMs = options.maxBackoffMs
    this._stream = new RealtimeSpanStream(wire, streamOptions)
  }

  // -------------------------------------------------------------------------
  // ASRProvider interface — delegates to the shared stream
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
  // Internal: parse Voxtral payload -> TranscriptSpan(s)
  // -------------------------------------------------------------------------

  private _parseMessage(message: unknown): TranscriptSpan[] {
    const delta = DeltaEventSchema.safeParse(message)
    if (delta.success) {
      const span = this._toInterim(delta.data.text)
      return span === null ? [] : [span]
    }

    const final = FinalEventSchema.safeParse(message)
    if (final.success) {
      const span = this._toFinal(final.data)
      return span === null ? [] : [span]
    }

    return []
  }

  private _toInterim(rawText: string): TranscriptSpan | null {
    const text = rawText.trim()
    if (text.length === 0) return null
    const nowMs = Math.max(0, this._clock.now() - this._startedAtMs)
    return parseSpan({
      id: randomUUID(),
      text,
      startMs: this._lastEndMs,
      endMs: nowMs,
      isFinal: false,
    })
  }

  private _toFinal(data: z.infer<typeof FinalEventSchema>): TranscriptSpan | null {
    const text = data.text.trim()
    if (text.length === 0) return null

    const nowMs = Math.max(0, this._clock.now() - this._startedAtMs)
    const startMs = data.start !== undefined ? Math.round(data.start * 1000) : this._lastEndMs
    const endMs = data.end !== undefined ? Math.round(data.end * 1000) : nowMs

    const raw: Record<string, unknown> = {
      id: randomUUID(),
      text,
      startMs,
      endMs,
      isFinal: true,
    }
    if (data.speaker !== undefined) raw.speakerLabel = `Speaker ${String(data.speaker)}`

    const span = parseSpan(raw)
    if (span !== null) this._lastEndMs = endMs
    return span
  }
}

function parseSpan(raw: Record<string, unknown>): TranscriptSpan | null {
  const parsed = TranscriptSpanSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
