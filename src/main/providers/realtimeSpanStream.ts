/**
 * RealtimeSpanStream — the shared transport plumbing behind every streaming ASR
 * adapter (Deepgram, OpenAI Realtime, Voxtral).
 *
 * Each streaming vendor used to carry a near-identical copy of this machinery:
 * the `_queue` / `_waiters` async-iterator behind `spans()`, `stop()` draining
 * waiters, the `_connect` + `_reconnectAfterDelay` exponential-backoff loop, the
 * `string | ArrayBuffer | Uint8Array -> JSON` message decoder, and the
 * emit-to-waiter-or-queue push. That is exactly the transport plumbing the
 * extraction side already hides behind its wire seam (`ExtractionWire`); this is
 * its ASR counterpart.
 *
 * What actually varies per vendor is small and lives behind the {@link
 * RealtimeAsrWire} seam: the connection (URL + auth), the session-config message
 * on open, the audio-frame encoding, and the event -> TranscriptSpan parse.
 *
 * ## Terminal states (audit finding C4)
 * Reconnect is not unconditional. A permanent auth failure (revoked/invalid key:
 * an auth close code, or a handshake rejected with HTTP 401/403) stops retrying
 * immediately, and a run of consecutive connect failures with no working session
 * hits a ceiling. Either way the stream terminates: it stops reconnecting,
 * completes the spans() iterator, and fires the injected `onTerminal` callback
 * once so the observer can surface it — otherwise a dead key just goes quiet.
 *
 * ## On ADR 0028 ("no shared realtime wire across vendors")
 * ADR 0028 is about the *protocol* — session config and event shapes stay
 * per-vendor, and they do: each wire owns its own `onOpen` and `parseMessage`.
 * This module shares only *transport plumbing*, sharpening 0028 rather than
 * contradicting it.
 *
 * ## Privacy (principle #12)
 * The stream never logs audio, transcript text, or the raw payload. Only
 * non-sensitive lifecycle metadata (socket open/close, reconnect attempt and
 * backoff delay) is logged, prefixed with the wire's name. Auth material lives
 * entirely inside the wire's `connect()` and is never seen here.
 */

import type { TranscriptSpan } from '@shared/domain/types'

// ---------------------------------------------------------------------------
// WebSocket abstraction
//
// The Electron MAIN process (Node) does not expose a global `WebSocket`, so the
// adapters depend on a minimal structural interface backed by the Node `ws`
// package. Tests inject a FakeWebSocket of the same shape.
// ---------------------------------------------------------------------------

/** The browser-like WebSocket surface the realtime adapters actually use. */
export interface WebSocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message: string }) => void) | null
  onclose: ((event?: { code?: number; reason?: string }) => void) | null
  send(data: Uint8Array | string): void
  close(): void
}

/** WebSocket readyState OPEN, per the WHATWG spec (and `ws`). */
export const WS_OPEN = 1

// ---------------------------------------------------------------------------
// The vendor seam
// ---------------------------------------------------------------------------

/**
 * Everything a realtime ASR vendor supplies beyond the generic transport. The
 * stream calls these; the wire owns URL, auth, session config, frame encoding
 * and event parsing.
 */
export interface RealtimeAsrWire {
  /** Human name used in log lines, e.g. 'DeepgramAsrProvider'. */
  readonly name: string

  /**
   * Open a new socket. The URL and auth (subprotocol or headers) are the wire's
   * concern; the stream only wires up lifecycle handlers on the returned socket.
   * Called again on every reconnect.
   */
  connect(): WebSocketLike

  /**
   * Reset per-session state (e.g. clock-derived span timing) at `start()`.
   * Optional — Deepgram carries its timing in the payload and needs nothing.
   */
  reset?(): void

  /**
   * Send the session-config message(s) once the socket is open. Optional —
   * Deepgram configures everything via the URL and sends nothing.
   */
  onOpen?(socket: WebSocketLike): void

  /** Encode a captured PCM frame for the wire (raw bytes, base64 JSON, ...). */
  encodeFrame(chunk: Uint8Array): Uint8Array | string

  /**
   * Parse one decoded JSON message into zero or more spans. The stream has
   * already turned the raw frame into `unknown` via JSON.parse; the wire
   * validates it (Zod at the boundary) and maps it to TranscriptSpans. Returning
   * `[]` skips a message that isn't a transcript event.
   */
  parseMessage(message: unknown): TranscriptSpan[]
}

/**
 * Why the stream terminated permanently and stopped reconnecting.
 * - `auth`        — a permanent authentication failure (revoked/invalid key):
 *                   retrying can never succeed, so the stream gives up at once.
 * - `max-retries` — too many consecutive connect failures with no working
 *                   session in between: the endpoint is unreachable, so the
 *                   stream stops the endless backoff loop.
 */
export interface RealtimeTerminalState {
  reason: 'auth' | 'max-retries'
}

export interface RealtimeSpanStreamOptions {
  /** Async sleep, injected for deterministic tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Maximum backoff delay in milliseconds. Default 30 000 ms. */
  maxBackoffMs?: number
  /**
   * Consecutive connect failures (closes/errors with no working session in
   * between) allowed before the stream gives up with `max-retries`. A successful
   * open resets the count. Default 8.
   */
  maxConsecutiveFailures?: number
  /**
   * Called once when the stream terminates permanently (auth failure or the
   * consecutive-failure ceiling). After this fires the stream stops reconnecting
   * and the spans() iterator completes. The observer (ASR provider / runtime)
   * can surface it to the user — otherwise a revoked key just goes quiet.
   */
  onTerminal?: (state: RealtimeTerminalState) => void
}

// ---------------------------------------------------------------------------
// Backoff constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000
const BACKOFF_MULTIPLIER = 2
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 8

// ---------------------------------------------------------------------------
// Permanent-failure classification
//
// A permanent auth failure must NOT be retried — a revoked or invalid key never
// heals on its own, so reconnecting forever just hides the problem. Two signals
// mark it, across all realtime wires (all cast a raw `ws` socket):
//   - a close code in the auth range — WebSocket policy-violation 1008, plus the
//     Deepgram private-range auth codes 4001 / 4008;
//   - a handshake error whose message carries HTTP 401 / 403 (`ws` surfaces
//     "Unexpected server response: 401" when the upgrade is rejected).
// ---------------------------------------------------------------------------

const AUTH_CLOSE_CODES = new Set([1008, 4001, 4008])

function isAuthCloseCode(code: number | undefined): boolean {
  return code !== undefined && AUTH_CLOSE_CODES.has(code)
}

function isAuthErrorMessage(message: string): boolean {
  return /\b(401|403)\b/.test(message)
}

// ---------------------------------------------------------------------------
// The deep module
// ---------------------------------------------------------------------------

export class RealtimeSpanStream {
  private readonly _wire: RealtimeAsrWire
  private readonly _sleep: (ms: number) => Promise<void>
  private readonly _maxBackoffMs: number
  private readonly _maxConsecutiveFailures: number
  private readonly _onTerminal: ((state: RealtimeTerminalState) => void) | undefined

  private _socket: WebSocketLike | null = null
  private _stopped = false
  /** Consecutive connect failures since the last successful open. */
  private _consecutiveFailures = 0
  /** Set once a terminal state has fired, so it never fires twice. */
  private _terminated = false

  /** Spans waiting to be consumed by the iterator. */
  private _queue: TranscriptSpan[] = []
  /** Promises waiting for the next queued span. */
  private _waiters: ((result: IteratorResult<TranscriptSpan>) => void)[] = []

  constructor(wire: RealtimeAsrWire, options?: RealtimeSpanStreamOptions) {
    this._wire = wire
    this._sleep = options?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this._maxBackoffMs = options?.maxBackoffMs ?? 30_000
    this._maxConsecutiveFailures =
      options?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
    this._onTerminal = options?.onTerminal
  }

  // -------------------------------------------------------------------------
  // Public surface (matches the streaming half of ASRProvider)
  // -------------------------------------------------------------------------

  start(): void {
    this._stopped = false
    this._terminated = false
    this._consecutiveFailures = 0
    this._wire.reset?.()
    this._connect(0)
  }

  stop(): void {
    this._stopped = true
    this._socket?.close()
    this._socket = null
    // Drain any waiters so the iterator completes.
    const done: IteratorReturnResult<undefined> = { value: undefined, done: true }
    for (const resolve of this._waiters) {
      resolve(done)
    }
    this._waiters = []
  }

  pushAudioFrame(chunk: Uint8Array): void {
    if (this._socket?.readyState === WS_OPEN) {
      this._socket.send(this._wire.encodeFrame(chunk))
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

    const socket = this._wire.connect()
    this._socket = socket

    socket.onopen = () => {
      console.info(`[${this._wire.name}] Socket opened`)
      // A working session clears the consecutive-failure tally so a healthy but
      // flaky link never drifts toward the ceiling.
      this._consecutiveFailures = 0
      this._wire.onOpen?.(socket)
    }

    socket.onmessage = (event: { data: unknown }) => {
      this._handleMessage(event.data)
    }

    socket.onerror = (event) => {
      // Only log the fact of the error, never its content (principle #12).
      // A handshake rejected with HTTP 401/403 is a permanent auth failure — the
      // key is bad — so stop rather than reconnect into the same wall.
      if (isAuthErrorMessage(event.message)) {
        console.error(`[${this._wire.name}] Socket error — authentication rejected, giving up`)
        this._terminate('auth')
        return
      }
      console.error(`[${this._wire.name}] Socket error — will reconnect`)
    }

    socket.onclose = (event) => {
      if (this._stopped) return
      // An auth close (1008 / 4001 / 4008) is a revoked/invalid key, not a
      // network blip — reconnecting can never succeed, so terminate at once.
      if (isAuthCloseCode(event?.code)) {
        const reason =
          event?.reason !== undefined && event.reason !== '' ? ` (${event.reason})` : ''
        console.error(
          `[${this._wire.name}] Socket closed (code ${String(event?.code)}${reason}) — authentication rejected, giving up`,
        )
        this._terminate('auth')
        return
      }

      // Transient close: count it. Too many in a row with no working session in
      // between means the endpoint is unreachable — stop the endless loop.
      this._consecutiveFailures += 1
      if (this._consecutiveFailures >= this._maxConsecutiveFailures) {
        console.error(
          `[${this._wire.name}] Giving up after ${String(this._consecutiveFailures)} consecutive reconnect failures`,
        )
        this._terminate('max-retries')
        return
      }

      // Log the close code/reason (non-sensitive) to aid diagnosis. Never log the key.
      const code = event?.code !== undefined ? String(event.code) : 'unknown'
      const reason = event?.reason !== undefined && event.reason !== '' ? ` (${event.reason})` : ''
      const nextBackoff = Math.min(
        backoffMs === 0 ? INITIAL_BACKOFF_MS : backoffMs * BACKOFF_MULTIPLIER,
        this._maxBackoffMs,
      )
      console.info(
        `[${this._wire.name}] Socket closed (code ${code}${reason}) — reconnecting in ${String(nextBackoff)}ms`,
      )
      void this._reconnectAfterDelay(nextBackoff)
    }
  }

  /**
   * Terminate the stream permanently: stop reconnecting, complete the iterator,
   * and notify the observer once. Idempotent — a follow-up close/error after the
   * first terminal signal is ignored.
   */
  private _terminate(reason: RealtimeTerminalState['reason']): void {
    if (this._terminated) return
    this._terminated = true
    // Reuse stop()'s teardown: gate reconnects and drain the iterator waiters so
    // spans() completes instead of hanging silently.
    this.stop()
    this._onTerminal?.({ reason })
  }

  private async _reconnectAfterDelay(backoffMs: number): Promise<void> {
    await this._sleep(backoffMs)
    if (this._stopped) return
    this._connect(backoffMs)
  }

  // -------------------------------------------------------------------------
  // Internal: decode frame -> JSON -> wire.parseMessage -> push spans
  // -------------------------------------------------------------------------

  private _handleMessage(raw: unknown): void {
    // `ws` delivers text frames as a Buffer in Node; the browser delivers a
    // string. Normalise to string before parsing; ArrayBuffer/typed arrays are
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
      // Malformed JSON — skip silently, never log raw content (principle #12).
      return
    }

    for (const span of this._wire.parseMessage(parsed)) {
      this._push(span)
    }
  }

  private _push(span: TranscriptSpan): void {
    const waiter = this._waiters.shift()
    if (waiter !== undefined) {
      waiter({ value: span, done: false })
    } else {
      this._queue.push(span)
    }
  }
}
