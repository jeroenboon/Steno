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
 * ### Interim + final spans
 * Deepgram emits `is_final=false` (interim) results as text stabilises, then
 * `is_final=true` once it commits. We emit both kinds as TranscriptSpan with
 * `isFinal` set accordingly. Consumers (the extraction loop) must filter to
 * `isFinal === true` (or `isFinal !== false`). See ADR 0011 for the rationale.
 *
 * ### Reconnect / backoff
 * On socket close or error the provider reconnects with exponential backoff
 * (1s → 2s → 4s → ... → maxBackoffMs). The `sleep` function is injected so
 * tests can resolve it instantly with no real timer waits. The session
 * (in-progress span queue and iterator) survives across reconnects.
 *
 * ### Privacy (principle #12)
 * The API key appears only in the WebSocket URL, never in any log line.
 * Audio frames, transcript text, and raw payloads are never logged.
 * Only non-sensitive metadata (reconnect attempt number, backoff delay,
 * socket open/close events) is written to logs.
 */

import { randomUUID } from 'node:crypto'

import WebSocketImpl from 'ws'
import { z } from 'zod'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import type { ASRProvider } from '@shared/providers'

// ---------------------------------------------------------------------------
// WebSocket abstraction
//
// The Electron MAIN process (Node) does not expose a global `WebSocket`, so we
// cannot rely on the DOM `WebSocket` at runtime even though @types/node now
// declares it. We depend on a minimal structural interface and back the default
// factory with the Node `ws` package. Tests inject a FakeWebSocket of the same
// shape. (Referencing the global WebSocket here is exactly what caused the
// "WebSocket is not defined" ReferenceError in the main process.)
// ---------------------------------------------------------------------------

/** The browser-like WebSocket surface this adapter actually uses. */
export interface WebSocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: { message: string }) => void) | null
  onclose: (() => void) | null
  send(data: Uint8Array | string): void
  close(): void
}

/** WebSocket readyState OPEN, per the WHATWG spec (and `ws`). */
const WS_OPEN = 1

// ---------------------------------------------------------------------------
// Deepgram WebSocket URL helpers
// ---------------------------------------------------------------------------

const DEEPGRAM_WSS_BASE = 'wss://api.deepgram.com/v1/listen'

function buildDeepgramUrl(apiKey: string, language: string): string {
  const params = new URLSearchParams({
    language,
    model: 'nova-2',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    diarize: 'true',
    interim_results: 'true',
  })
  return `${DEEPGRAM_WSS_BASE}?${params.toString()}&token=${apiKey}`
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

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/** Factory that produces a WebSocket-compatible instance. Injected for testability. */
export type WebSocketFactory = (url: string) => WebSocketLike

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
}

// ---------------------------------------------------------------------------
// Backoff constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000
const BACKOFF_MULTIPLIER = 2

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DeepgramAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _language: string
  private readonly _sleep: (ms: number) => Promise<void>
  private readonly _maxBackoffMs: number
  private readonly _wsFactory: WebSocketFactory

  private _socket: WebSocketLike | null = null
  private _stopped = false

  /** Spans waiting to be consumed by the iterator. */
  private _queue: TranscriptSpan[] = []
  /** Promises waiting for the next queued span. */
  private _waiters: ((result: IteratorResult<TranscriptSpan>) => void)[] = []

  constructor(options: DeepgramAsrProviderOptions) {
    this._apiKey = options.apiKey
    this._language = options.language ?? 'nl'
    this._sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this._maxBackoffMs = options.maxBackoffMs ?? 30_000
    this._wsFactory =
      options.webSocketFactory ?? ((url) => new WebSocketImpl(url) as unknown as WebSocketLike)
  }

  // -------------------------------------------------------------------------
  // ASRProvider interface
  // -------------------------------------------------------------------------

  start(): void {
    this._stopped = false
    this._connect(0)
  }

  stop(): void {
    this._stopped = true
    this._socket?.close()
    this._socket = null
    // Drain any waiters so the iterator completes
    const done: IteratorReturnResult<undefined> = { value: undefined, done: true }
    for (const resolve of this._waiters) {
      resolve(done)
    }
    this._waiters = []
  }

  pushAudioFrame(chunk: Uint8Array): void {
    if (this._socket?.readyState === WS_OPEN) {
      this._socket.send(chunk)
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

    // Build URL — API key embedded in query param, never logged
    const url = buildDeepgramUrl(this._apiKey, this._language)
    const socket = this._wsFactory(url)
    this._socket = socket

    socket.onopen = () => {
      console.info('[DeepgramAsrProvider] Socket opened')
      // Reset backoff on successful open
      // (we track backoff in the reconnect path, not here)
    }

    socket.onmessage = (event: { data: unknown }) => {
      this._handleMessage(event.data)
    }

    socket.onerror = () => {
      // Only log the fact of the error, not the content
      console.error('[DeepgramAsrProvider] Socket error — will reconnect')
    }

    socket.onclose = () => {
      if (this._stopped) return
      // Reconnect with backoff; never log the key or any audio content
      const nextBackoff = Math.min(
        backoffMs === 0 ? INITIAL_BACKOFF_MS : backoffMs * BACKOFF_MULTIPLIER,
        this._maxBackoffMs,
      )
      console.info(`[DeepgramAsrProvider] Socket closed — reconnecting in ${String(nextBackoff)}ms`)
      void this._reconnectAfterDelay(nextBackoff)
    }
  }

  private async _reconnectAfterDelay(backoffMs: number): Promise<void> {
    await this._sleep(backoffMs)
    if (this._stopped) return
    this._connect(backoffMs)
  }

  // -------------------------------------------------------------------------
  // Internal: parse Deepgram payload → TranscriptSpan
  // -------------------------------------------------------------------------

  private _handleMessage(raw: unknown): void {
    // `ws` delivers text frames as a Buffer in Node; the browser delivers a
    // string. Normalise to string before parsing. ArrayBuffer/typed arrays are
    // handled too for safety.
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
      // Malformed JSON — skip silently, never log raw content (principle #12)
      return
    }

    const result = DeepgramResultSchema.safeParse(parsed)
    if (!result.success) {
      // Not a Results message (could be metadata/keepalive) — skip
      return
    }

    const span = this._toTranscriptSpan(result.data)
    if (span === null) return

    const waiter = this._waiters.shift()
    if (waiter !== undefined) {
      waiter({ value: span, done: false })
    } else {
      this._queue.push(span)
    }
  }

  private _toTranscriptSpan(result: DeepgramResult): TranscriptSpan | null {
    const alt = result.channel.alternatives[0]
    if (alt === undefined) return null

    const transcript = alt.transcript.trim()
    if (transcript.length === 0) return null

    // Resolve speaker label from the first word's speaker field
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

    // Validate through the shared Zod schema (principle #8)
    const parsed = TranscriptSpanSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }
}
