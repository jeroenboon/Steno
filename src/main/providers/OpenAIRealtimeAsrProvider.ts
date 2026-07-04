/**
 * OpenAIRealtimeAsrProvider (Phase 4.1).
 *
 * Live streaming cloud ASR adapter behind the ASRProvider port, using OpenAI's
 * Realtime transcription WebSocket API directly (no SDK dependency). The same
 * Realtime wire is reused for Azure OpenAI (Phase 4.2) via an injected
 * connection builder — only the URL + auth header differ.
 *
 * ## Design decisions (see ADR 0011 for the template, ADR 0028 for why ASR has
 * no shared realtime protocol across vendors)
 *
 * ### Raw WebSocket over the OpenAI SDK
 * Injecting a WebSocketFactory makes the transport boundary fully mockable in
 * tests without faking an entire SDK object graph (mirrors DeepgramAsrProvider).
 *
 * ### Shared transport plumbing
 * The generic realtime machinery (span queue + async-iterator, reconnect with
 * backoff, frame decode) lives in {@link RealtimeSpanStream}. This adapter is
 * the OpenAI Realtime {@link RealtimeAsrWire}: the connection (URL + auth
 * header), the `transcription_session.update` sent on open, the pcm16/base64
 * frame encoding, and the delta/completed -> TranscriptSpan parse.
 *
 * ### Interim + final spans
 * OpenAI Realtime emits `conversation.item.input_audio_transcription.delta`
 * (interim text) as audio is processed, then a matching `...completed` event
 * with the full transcript once a segment commits. We emit both as
 * TranscriptSpan with `isFinal` set accordingly; consumers (the extraction
 * loop) filter to `isFinal !== false`.
 *
 * ### Timing
 * The Realtime transcription events carry no reliable per-segment timestamps,
 * so span start/end are derived from an injected Clock (elapsed since start()).
 * That keeps spans monotonically ordered for live display; extraction uses the
 * full transcript on the final pass regardless.
 *
 * ### Privacy (principle #12)
 * The API key travels only in the connection header, never in any log line.
 * Audio frames, transcript text, and raw payloads are never logged.
 */

import { randomUUID } from 'node:crypto'

import WebSocketImpl from 'ws'
import { z } from 'zod'

import { CAPTURE_SAMPLE_RATE, resamplePcm16 } from '@shared/audio/pcmResampler'
import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import { RealClock, type ASRProvider, type Clock } from '@shared/providers'

import { RealtimeSpanStream, type RealtimeAsrWire, type WebSocketLike } from './realtimeSpanStream'

// ---------------------------------------------------------------------------
// WebSocket abstraction
//
// Unlike Deepgram (auth via subprotocol), OpenAI Realtime authenticates with an
// Authorization header, so the realtime factory accepts header options. The
// Node `ws` package takes them as the third constructor argument; the browser
// WebSocket cannot set headers (a non-issue: this runs in the Electron main
// process). Tests inject a FakeWebSocket of the same shape.
// ---------------------------------------------------------------------------

/** Connection options passed to the WebSocket factory. */
export interface RealtimeWebSocketOptions {
  headers?: Record<string, string>
  protocols?: string | string[]
}

export type RealtimeWebSocketFactory = (
  url: string,
  options?: RealtimeWebSocketOptions,
) => WebSocketLike

// ---------------------------------------------------------------------------
// Connection descriptor (URL + auth) — injectable so Azure (4.2) reuses the wire
// ---------------------------------------------------------------------------

export interface RealtimeConnection {
  url: string
  options?: RealtimeWebSocketOptions
}

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'

const DEFAULT_MODEL = 'gpt-4o-transcribe'

/**
 * OpenAI Realtime expects `pcm16` at 24 kHz, mono, little-endian. The renderer
 * captures at CAPTURE_SAMPLE_RATE (16 kHz), so frames are resampled before send;
 * otherwise 16 kHz audio is read as 24 kHz (sped up, pitch-shifted, poor WER).
 */
const OPENAI_REALTIME_SAMPLE_RATE = 24_000

// ---------------------------------------------------------------------------
// Event schemas (Zod at the boundary — principle #8)
// ---------------------------------------------------------------------------

const DeltaEventSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.delta'),
  delta: z.string(),
})

const CompletedEventSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.completed'),
  transcript: z.string(),
})

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface OpenAIRealtimeAsrProviderOptions {
  /** OpenAI API key. Injected; never read from disk here. */
  apiKey: string
  /** Transcription model, e.g. 'gpt-4o-transcribe'. Default 'gpt-4o-transcribe'. */
  model?: string
  /** BCP-47 language tag, e.g. 'nl'. Default 'nl'. */
  language?: string
  /** Async sleep, injected for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
  /** Maximum backoff delay in milliseconds. Default 30 000 ms. */
  maxBackoffMs?: number
  /** Clock for span timing. Injected for deterministic tests. */
  clock?: Clock
  /** WebSocket factory. Injected for tests; defaults to the Node `ws` package. */
  webSocketFactory?: RealtimeWebSocketFactory
  /**
   * Sample rate (Hz) the endpoint expects. Capture audio (16 kHz) is resampled
   * to this before sending. Defaults to OpenAI Realtime's 24 kHz; Azure reuses
   * the same wire and rate.
   */
  inputSampleRate?: number
  /**
   * Connection builder (URL + auth). Defaults to OpenAI's public endpoint with
   * Bearer auth. Azure OpenAI (Phase 4.2) injects its own deployment URL and
   * `api-key` header here, reusing all the frame handling below.
   */
  buildConnection?: (apiKey: string) => RealtimeConnection
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIRealtimeAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _model: string
  private readonly _language: string
  private readonly _clock: Clock
  private readonly _wsFactory: RealtimeWebSocketFactory
  private readonly _buildConnection: (apiKey: string) => RealtimeConnection
  private readonly _inputSampleRate: number
  private readonly _stream: RealtimeSpanStream

  // Per-session span timing, reset on start(). The Realtime events carry no
  // timestamps, so spans are timed from the Clock elapsed since start().
  private _startedAtMs = 0
  private _lastEndMs = 0

  constructor(options: OpenAIRealtimeAsrProviderOptions) {
    this._apiKey = options.apiKey
    this._model = options.model ?? DEFAULT_MODEL
    this._language = options.language ?? 'nl'
    this._clock = options.clock ?? new RealClock()
    this._wsFactory =
      options.webSocketFactory ??
      ((url, opts) =>
        new WebSocketImpl(
          url,
          opts?.protocols,
          opts?.headers ? { headers: opts.headers } : undefined,
        ) as unknown as WebSocketLike)
    this._buildConnection = options.buildConnection ?? defaultOpenAIConnection
    this._inputSampleRate = options.inputSampleRate ?? OPENAI_REALTIME_SAMPLE_RATE

    const wire: RealtimeAsrWire = {
      name: 'OpenAIRealtimeAsrProvider',
      connect: () => {
        const { url, options: connOpts } = this._buildConnection(this._apiKey)
        return this._wsFactory(url, connOpts)
      },
      reset: () => {
        this._startedAtMs = this._clock.now()
        this._lastEndMs = 0
      },
      onOpen: (socket) => {
        socket.send(
          JSON.stringify({
            type: 'transcription_session.update',
            session: {
              input_audio_format: 'pcm16',
              input_audio_transcription: { model: this._model, language: this._language },
              turn_detection: { type: 'server_vad' },
            },
          }),
        )
      },
      encodeFrame: (chunk) => {
        const resampled = resamplePcm16(chunk, CAPTURE_SAMPLE_RATE, this._inputSampleRate)
        const audio = Buffer.from(resampled).toString('base64')
        return JSON.stringify({ type: 'input_audio_buffer.append', audio })
      },
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
  // Internal: parse Realtime payload -> TranscriptSpan(s)
  // -------------------------------------------------------------------------

  private _parseMessage(message: unknown): TranscriptSpan[] {
    const delta = DeltaEventSchema.safeParse(message)
    if (delta.success) {
      const span = this._toSpan(delta.data.delta, false)
      return span === null ? [] : [span]
    }

    const completed = CompletedEventSchema.safeParse(message)
    if (completed.success) {
      const span = this._toSpan(completed.data.transcript, true)
      return span === null ? [] : [span]
    }

    // Other events (session.created, committed, errors) are ignored.
    return []
  }

  private _toSpan(rawText: string, isFinal: boolean): TranscriptSpan | null {
    const text = rawText.trim()
    if (text.length === 0) return null

    const nowMs = Math.max(0, this._clock.now() - this._startedAtMs)
    const span = TranscriptSpanSchema.safeParse({
      id: randomUUID(),
      text,
      startMs: this._lastEndMs,
      endMs: nowMs,
      isFinal,
    })
    if (!span.success) return null
    if (isFinal) this._lastEndMs = nowMs
    return span.data
  }
}

// ---------------------------------------------------------------------------
// Default connection: OpenAI public endpoint, Bearer auth
// ---------------------------------------------------------------------------

function defaultOpenAIConnection(apiKey: string): RealtimeConnection {
  return {
    url: OPENAI_REALTIME_URL,
    options: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    },
  }
}
