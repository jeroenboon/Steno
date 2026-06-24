/**
 * MistralVoxtralRealtimeAsrProvider (Phase 4.3).
 *
 * Live streaming cloud ASR adapter behind the ASRProvider port, using Mistral's
 * Voxtral Realtime WebSocket API directly. This is a distinct wire from OpenAI
 * Realtime and Deepgram (ADR 0028: ASR has no shared realtime protocol across
 * vendors), so it is its own adapter rather than a reuse.
 *
 * ## Wire
 * - Connect with a Bearer Authorization header.
 * - On open, send a session config message ({ model, language }).
 * - Audio is sent as raw binary PCM frames (no base64 wrapping).
 * - Transcription events come back as JSON:
 *     { type: 'transcript.delta', text }                      → interim span
 *     { type: 'transcript.final', text, start?, end?, speaker? } → final span
 *   Voxtral carries diarization, so `speaker` maps onto TranscriptSpan
 *   `speakerLabel` (Speaker N), lighting up the Speaker-label → Participant flow.
 *   Segment timing uses the event's start/end seconds when present, else the
 *   injected Clock's elapsed time.
 *
 * ## Reconnect / backoff
 * On socket close/error the provider reconnects with exponential backoff; the
 * span queue + iterator survive reconnects. `sleep` is injected for tests.
 *
 * ## Privacy (principle #12)
 * The API key travels only in the connection header; audio, transcript text and
 * raw payloads are never logged — only non-sensitive lifecycle metadata.
 */

import { randomUUID } from 'node:crypto'

import WebSocketImpl from 'ws'
import { z } from 'zod'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import { RealClock, type ASRProvider, type Clock } from '@shared/providers'

import type { WebSocketLike } from './DeepgramAsrProvider'

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

const WS_OPEN = 1

const VOXTRAL_REALTIME_URL = 'wss://api.mistral.ai/v1/audio/transcriptions/realtime'
const DEFAULT_MODEL = 'voxtral-mini-2507'

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

const INITIAL_BACKOFF_MS = 1_000
const BACKOFF_MULTIPLIER = 2

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MistralVoxtralRealtimeAsrProvider implements ASRProvider {
  private readonly _apiKey: string
  private readonly _model: string
  private readonly _language: string
  private readonly _sleep: (ms: number) => Promise<void>
  private readonly _maxBackoffMs: number
  private readonly _clock: Clock
  private readonly _wsFactory: MistralRealtimeWebSocketFactory

  private _socket: WebSocketLike | null = null
  private _stopped = false
  private _startedAtMs = 0
  private _lastEndMs = 0

  private _queue: TranscriptSpan[] = []
  private _waiters: ((result: IteratorResult<TranscriptSpan>) => void)[] = []

  constructor(options: MistralVoxtralRealtimeAsrProviderOptions) {
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
          undefined,
          opts?.headers ? { headers: opts.headers } : undefined,
        ) as unknown as WebSocketLike)
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

    const socket = this._wsFactory(VOXTRAL_REALTIME_URL, {
      headers: { Authorization: `Bearer ${this._apiKey}` },
    })
    this._socket = socket

    socket.onopen = () => {
      console.info('[MistralVoxtralRealtimeAsrProvider] Socket opened')
      this._configureSession()
    }

    socket.onmessage = (event: { data: unknown }) => {
      this._handleMessage(event.data)
    }

    socket.onerror = () => {
      console.error('[MistralVoxtralRealtimeAsrProvider] Socket error — will reconnect')
    }

    socket.onclose = (event) => {
      if (this._stopped) return
      const code = event?.code !== undefined ? String(event.code) : 'unknown'
      const nextBackoff = Math.min(
        backoffMs === 0 ? INITIAL_BACKOFF_MS : backoffMs * BACKOFF_MULTIPLIER,
        this._maxBackoffMs,
      )
      console.info(
        `[MistralVoxtralRealtimeAsrProvider] Socket closed (code ${code}) — reconnecting in ${String(nextBackoff)}ms`,
      )
      void this._reconnectAfterDelay(nextBackoff)
    }
  }

  private async _reconnectAfterDelay(backoffMs: number): Promise<void> {
    await this._sleep(backoffMs)
    if (this._stopped) return
    this._connect(backoffMs)
  }

  private _configureSession(): void {
    this._socket?.send(
      JSON.stringify({ type: 'session.start', model: this._model, language: this._language }),
    )
  }

  // -------------------------------------------------------------------------
  // Internal: parse Voxtral payload → TranscriptSpan
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
      this._emitInterim(delta.data.text)
      return
    }

    const final = FinalEventSchema.safeParse(parsed)
    if (final.success) {
      this._emitFinal(final.data)
    }
  }

  private _emitInterim(rawText: string): void {
    const text = rawText.trim()
    if (text.length === 0) return
    const nowMs = Math.max(0, this._clock.now() - this._startedAtMs)
    this._push({ id: randomUUID(), text, startMs: this._lastEndMs, endMs: nowMs, isFinal: false })
  }

  private _emitFinal(data: z.infer<typeof FinalEventSchema>): void {
    const text = data.text.trim()
    if (text.length === 0) return

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

    this._lastEndMs = endMs
    this._push(raw)
  }

  private _push(raw: Record<string, unknown>): void {
    const parsed = TranscriptSpanSchema.safeParse(raw)
    if (!parsed.success) return

    const waiter = this._waiters.shift()
    if (waiter !== undefined) {
      waiter({ value: parsed.data, done: false })
    } else {
      this._queue.push(parsed.data)
    }
  }
}
