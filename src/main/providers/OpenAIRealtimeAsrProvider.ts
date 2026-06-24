/**
 * OpenAIRealtimeAsrProvider (Phase 4.1).
 *
 * Live streaming cloud ASR adapter behind the ASRProvider port, using OpenAI's
 * Realtime transcription WebSocket API directly (no SDK dependency). The same
 * Realtime wire is reused for Azure OpenAI (Phase 4.2) via an injected
 * connection builder — only the URL + auth header differ.
 *
 * ## Design decisions (see ADR 0011 for the template, ADR 0028 for why ASR has
 * no shared realtime wire across vendors)
 *
 * ### Raw WebSocket over the OpenAI SDK
 * Injecting a WebSocketFactory makes the transport boundary fully mockable in
 * tests without faking an entire SDK object graph (mirrors DeepgramAsrProvider).
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
 * ### Reconnect / backoff
 * On socket close/error the provider reconnects with exponential backoff
 * (1s → 2s → ... → maxBackoffMs). `sleep` is injected so tests resolve it
 * instantly. The session (span queue + iterator) survives reconnects.
 *
 * ### Privacy (principle #12)
 * The API key travels only in the connection header, never in any log line.
 * Audio frames, transcript text, and raw payloads are never logged — only
 * non-sensitive metadata (reconnect attempts, backoff, socket lifecycle).
 */

import { randomUUID } from 'node:crypto'

import WebSocketImpl from 'ws'
import { z } from 'zod'

import { CAPTURE_SAMPLE_RATE, resamplePcm16 } from '@shared/audio/pcmResampler'
import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import { RealClock, type ASRProvider, type Clock } from '@shared/providers'

import type { WebSocketLike } from './DeepgramAsrProvider'

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

/** WebSocket readyState OPEN, per the WHATWG spec (and `ws`). */
const WS_OPEN = 1

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
// Backoff constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000
const BACKOFF_MULTIPLIER = 2

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIRealtimeAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _model: string
  private readonly _language: string
  private readonly _sleep: (ms: number) => Promise<void>
  private readonly _maxBackoffMs: number
  private readonly _clock: Clock
  private readonly _wsFactory: RealtimeWebSocketFactory
  private readonly _buildConnection: (apiKey: string) => RealtimeConnection
  private readonly _inputSampleRate: number

  private _socket: WebSocketLike | null = null
  private _stopped = false
  private _startedAtMs = 0
  private _lastEndMs = 0

  private _queue: TranscriptSpan[] = []
  private _waiters: ((result: IteratorResult<TranscriptSpan>) => void)[] = []

  constructor(options: OpenAIRealtimeAsrProviderOptions) {
    this._apiKey = options.apiKey
    this._model = options.model ?? DEFAULT_MODEL
    this._language = options.language ?? 'nl'
    this._sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this._maxBackoffMs = options.maxBackoffMs ?? 30_000
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
  }

  // -------------------------------------------------------------------------
  // ASRProvider interface
  // -------------------------------------------------------------------------

  start(): void {
    this._stopped = false
    this._startedAtMs = this._clock.now()
    this._lastEndMs = 0
    this._connect(0)
  }

  stop(): void {
    this._stopped = true
    this._socket?.close()
    this._socket = null
    const done: IteratorReturnResult<undefined> = { value: undefined, done: true }
    for (const resolve of this._waiters) {
      resolve(done)
    }
    this._waiters = []
  }

  pushAudioFrame(chunk: Uint8Array): void {
    if (this._socket?.readyState === WS_OPEN) {
      const resampled = resamplePcm16(chunk, CAPTURE_SAMPLE_RATE, this._inputSampleRate)
      const audio = Buffer.from(resampled).toString('base64')
      this._socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }))
    }
  }

  spans(): AsyncIterable<TranscriptSpan> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this

    return {
      [Symbol.asyncIterator](): AsyncIterator<TranscriptSpan> {
        return {
          next(): Promise<IteratorResult<TranscriptSpan>> {
            if (self._stopped && self._queue.length === 0) {
              return Promise.resolve({ value: undefined, done: true })
            }

            const queued = self._queue.shift()
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false })
            }

            if (self._stopped) {
              return Promise.resolve({ value: undefined, done: true })
            }

            return new Promise<IteratorResult<TranscriptSpan>>((resolve) => {
              self._waiters.push(resolve)
            })
          },
        }
      },
    }
  }

  // -------------------------------------------------------------------------
  // Internal: connect + reconnect
  // -------------------------------------------------------------------------

  private _connect(backoffMs: number): void {
    if (this._stopped) return

    const { url, options } = this._buildConnection(this._apiKey)
    const socket = this._wsFactory(url, options)
    this._socket = socket

    socket.onopen = () => {
      console.info('[OpenAIRealtimeAsrProvider] Socket opened')
      this._configureSession()
    }

    socket.onmessage = (event: { data: unknown }) => {
      this._handleMessage(event.data)
    }

    socket.onerror = () => {
      console.error('[OpenAIRealtimeAsrProvider] Socket error — will reconnect')
    }

    socket.onclose = (event) => {
      if (this._stopped) return
      const code = event?.code !== undefined ? String(event.code) : 'unknown'
      const nextBackoff = Math.min(
        backoffMs === 0 ? INITIAL_BACKOFF_MS : backoffMs * BACKOFF_MULTIPLIER,
        this._maxBackoffMs,
      )
      console.info(
        `[OpenAIRealtimeAsrProvider] Socket closed (code ${code}) — reconnecting in ${String(nextBackoff)}ms`,
      )
      void this._reconnectAfterDelay(nextBackoff)
    }
  }

  private async _reconnectAfterDelay(backoffMs: number): Promise<void> {
    await this._sleep(backoffMs)
    if (this._stopped) return
    this._connect(backoffMs)
  }

  /** Send the transcription_session.update event that configures model + language. */
  private _configureSession(): void {
    this._socket?.send(
      JSON.stringify({
        type: 'transcription_session.update',
        session: {
          input_audio_format: 'pcm16',
          input_audio_transcription: { model: this._model, language: this._language },
          turn_detection: { type: 'server_vad' },
        },
      }),
    )
  }

  // -------------------------------------------------------------------------
  // Internal: parse Realtime payload → TranscriptSpan
  // -------------------------------------------------------------------------

  private _handleMessage(raw: unknown): void {
    let text: string
    if (typeof raw === 'string') {
      text = raw
    } else if (raw instanceof ArrayBuffer) {
      text = Buffer.from(raw).toString('utf8')
    } else if (raw instanceof Uint8Array) {
      text = Buffer.from(raw).toString('utf8')
    } else {
      text = String(raw)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      return
    }

    const delta = DeltaEventSchema.safeParse(parsed)
    if (delta.success) {
      this._emitSpan(delta.data.delta, false)
      return
    }

    const completed = CompletedEventSchema.safeParse(parsed)
    if (completed.success) {
      this._emitSpan(completed.data.transcript, true)
    }
    // Other events (session.created, committed, errors) are ignored.
  }

  private _emitSpan(rawText: string, isFinal: boolean): void {
    const text = rawText.trim()
    if (text.length === 0) return

    const nowMs = Math.max(0, this._clock.now() - this._startedAtMs)
    const span = TranscriptSpanSchema.safeParse({
      id: randomUUID(),
      text,
      startMs: this._lastEndMs,
      endMs: nowMs,
      isFinal,
    })
    if (!span.success) return
    if (isFinal) this._lastEndMs = nowMs

    const waiter = this._waiters.shift()
    if (waiter !== undefined) {
      waiter({ value: span.data, done: false })
    } else {
      this._queue.push(span.data)
    }
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
