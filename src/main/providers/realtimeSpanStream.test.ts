/**
 * Tests for RealtimeSpanStream — the shared realtime transport plumbing that
 * every streaming ASR adapter (Deepgram, OpenAI Realtime, Voxtral) sits on.
 *
 * The stream owns everything generic: the span queue + async-iterator behind
 * spans(), stop() draining waiters, the connect + reconnect-with-backoff loop,
 * the bytes -> text -> JSON decode, and the emit-to-waiter-or-queue push. What a
 * vendor supplies is the RealtimeAsrWire seam: open a socket, (optionally) send
 * a session-config message on open, encode an audio frame, parse a message into
 * spans. These tests drive the stream through its public surface with a fake
 * wire + fake socket — no real network, no real timers.
 */

import { describe, expect, it, vi } from 'vitest'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import { captureConsole } from '@shared/testing/captureConsole'

import { RealtimeSpanStream, type RealtimeAsrWire, type WebSocketLike } from './realtimeSpanStream'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const WS_OPEN = 1
const WS_CLOSED = 3

class FakeWebSocket implements WebSocketLike {
  readyState = WS_OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null

  sent: (Uint8Array | string)[] = []
  closed = false

  send(data: Uint8Array | string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = WS_CLOSED
  }

  simulateOpen(): void {
    this.readyState = WS_OPEN
    this.onopen?.()
  }

  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  simulateRaw(data: unknown): void {
    this.onmessage?.({ data })
  }

  simulateClose(event?: { code?: number; reason?: string }): void {
    this.readyState = WS_CLOSED
    this.onclose?.(event)
  }

  simulateError(message = 'boom'): void {
    this.onerror?.({ message })
  }
}

/** Build a span from plain text (final unless told otherwise). */
function spanOf(text: string, isFinal = true): TranscriptSpan {
  return TranscriptSpanSchema.parse({
    id: '00000000-0000-4000-8000-000000000000',
    text,
    startMs: 0,
    endMs: 1000,
    isFinal,
  })
}

const instantSleep = () => Promise.resolve()

interface FakeWireOverrides {
  onOpen?: (socket: WebSocketLike) => void
  reset?: () => void
  encodeFrame?: (chunk: Uint8Array) => Uint8Array | string
  parseMessage?: (message: unknown) => TranscriptSpan[]
}

/** A wire whose sockets are handed out in order, recording seam calls. */
function makeFakeWire(overrides?: FakeWireOverrides) {
  const sockets: FakeWebSocket[] = []
  const calls = { reset: 0, onOpen: 0, encoded: [] as Uint8Array[] }

  const wire: RealtimeAsrWire = {
    name: 'FakeWire',
    connect(): WebSocketLike {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket
    },
    reset(): void {
      calls.reset++
      overrides?.reset?.()
    },
    onOpen(socket): void {
      calls.onOpen++
      overrides?.onOpen?.(socket)
    },
    encodeFrame(chunk): Uint8Array | string {
      calls.encoded.push(chunk)
      return overrides?.encodeFrame ? overrides.encodeFrame(chunk) : chunk
    },
    parseMessage(message): TranscriptSpan[] {
      if (overrides?.parseMessage) return overrides.parseMessage(message)
      // Default: treat { text } messages as a single final span.
      if (typeof message === 'object' && message !== null && 'text' in message) {
        const { text } = message
        if (typeof text === 'string') return [spanOf(text)]
      }
      return []
    },
  }

  return { wire, sockets, calls }
}

/** Collect N spans from the stream's spans() iterator. */
async function collectN(stream: RealtimeSpanStream, n: number): Promise<TranscriptSpan[]> {
  const result: TranscriptSpan[] = []
  for await (const span of stream.spans()) {
    result.push(span)
    if (result.length >= n) break
  }
  return result
}

function lastSocket(sockets: FakeWebSocket[]): FakeWebSocket {
  const s = sockets[sockets.length - 1]
  if (s === undefined) throw new Error('no socket yet')
  return s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RealtimeSpanStream', () => {
  it('emits a span parsed from an incoming message (tracer bullet)', async () => {
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    lastSocket(sockets).simulateOpen()

    const collectPromise = collectN(stream, 1)
    lastSocket(sockets).simulateMessage({ text: 'Hallo wereld' })

    const spans = await collectPromise
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('Hallo wereld')
  })

  it('resets the wire on start() and runs onOpen with the socket when it opens', () => {
    const opened: WebSocketLike[] = []
    const { wire, sockets, calls } = makeFakeWire({ onOpen: (s) => opened.push(s) })
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    expect(calls.reset).toBe(1)

    lastSocket(sockets).simulateOpen()
    expect(calls.onOpen).toBe(1)
    expect(opened[0]).toBe(lastSocket(sockets))
  })

  it('encodes audio frames through the wire and sends them only while the socket is open', () => {
    const { wire, sockets } = makeFakeWire({
      encodeFrame: (chunk) => `encoded:${String(chunk.length)}`,
    })
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    const socket = lastSocket(sockets)
    socket.simulateOpen()

    stream.pushAudioFrame(new Uint8Array([1, 2, 3]))
    expect(socket.sent).toEqual(['encoded:3'])

    // After the socket drops (not OPEN), frames are dropped, not queued.
    socket.readyState = WS_CLOSED
    stream.pushAudioFrame(new Uint8Array([4, 5]))
    expect(socket.sent).toEqual(['encoded:3'])
  })

  it('emits every span the wire returns for a single message', async () => {
    const { wire, sockets } = makeFakeWire({
      parseMessage: () => [spanOf('een', false), spanOf('een.')],
    })
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    lastSocket(sockets).simulateOpen()

    const collectPromise = collectN(stream, 2)
    lastSocket(sockets).simulateMessage({ anything: true })

    const spans = await collectPromise
    expect(spans.map((s) => s.isFinal)).toEqual([false, true])
  })

  it('skips malformed (non-JSON) frames without emitting or throwing', async () => {
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    const socket = lastSocket(sockets)
    socket.simulateOpen()

    const collectPromise = collectN(stream, 1)
    socket.simulateRaw('this is not json {')
    socket.simulateMessage({ text: 'na de rommel' })

    const spans = await collectPromise
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('na de rommel')
  })

  it('reconnects after a socket drop with backoff and keeps emitting spans', async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep })

    stream.start()
    sockets[0]?.simulateOpen()

    const collectPromise = collectN(stream, 2)
    sockets[0]?.simulateMessage({ text: 'eerste' })

    // Drop the socket; the stream should reconnect and open a fresh socket.
    sockets[0]?.simulateClose()
    await Promise.resolve()
    const second = lastSocket(sockets)
    second.simulateOpen()
    second.simulateMessage({ text: 'na reconnect' })

    const spans = await collectPromise
    expect(spans.map((s) => s.text)).toEqual(['eerste', 'na reconnect'])
    expect(delays[0]).toBe(1000) // first backoff
    expect(sockets.length).toBeGreaterThanOrEqual(2)
  })

  it('caps the reconnect backoff at maxBackoffMs', async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep, maxBackoffMs: 4_000 })

    stream.start()
    sockets[0]?.simulateOpen()

    for (let i = 0; i < 6; i++) {
      lastSocket(sockets).simulateClose()
      await Promise.resolve()
      lastSocket(sockets).simulateOpen()
      await Promise.resolve()
    }

    expect(delays.some((d) => d > 4_000)).toBe(false)
    expect(delays.length).toBeGreaterThan(0)
  })

  it('does not reconnect after stop()', async () => {
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    const socket = lastSocket(sockets)
    socket.simulateOpen()

    stream.stop()
    expect(socket.closed).toBe(true)

    socket.simulateClose()
    await Promise.resolve()
    // stop() closed the only socket; no reconnect socket was created.
    expect(sockets).toHaveLength(1)
  })

  it('completes the spans() iterator after stop()', async () => {
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    lastSocket(sockets).simulateOpen()

    const seen: TranscriptSpan[] = []
    const iterPromise = (async () => {
      for await (const span of stream.spans()) seen.push(span)
    })()

    lastSocket(sockets).simulateMessage({ text: 'laatste' })
    await Promise.resolve()
    stream.stop()

    await iterPromise // must resolve, not hang
    expect(seen.length).toBeGreaterThanOrEqual(1)
  })

  it('stops retrying and emits a terminal auth state on an auth-code close', async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    const terminals: { reason: string }[] = []
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, {
      sleep,
      onTerminal: (state) => terminals.push(state),
    })
    const console_ = captureConsole()

    stream.start()
    lastSocket(sockets).simulateOpen()

    // A revoked / invalid key closes the socket with an auth code (Deepgram 4001).
    lastSocket(sockets).simulateClose({ code: 4001, reason: 'Unauthorized' })
    await Promise.resolve()
    await Promise.resolve()

    // No reconnect attempt: still the single original socket, no backoff sleep.
    expect(sockets).toHaveLength(1)
    expect(delays).toHaveLength(0)
    // Terminal auth state surfaced exactly once.
    expect(terminals).toEqual([{ reason: 'auth' }])
    console_.expectLogged('[FakeWire] Socket closed', 'authentication rejected')
    console_.restore()
  })

  it('gives up with a max-retries terminal state after N consecutive failures', async () => {
    const terminals: { reason: string }[] = []
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, {
      sleep: instantSleep,
      maxConsecutiveFailures: 3,
      onTerminal: (state) => terminals.push(state),
    })
    const console_ = captureConsole()

    stream.start()
    lastSocket(sockets).simulateOpen()

    // Repeatedly close without a successful open in between (endpoint down).
    for (let i = 0; i < 3; i++) {
      lastSocket(sockets).simulateClose({ code: 1006 })
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(terminals).toEqual([{ reason: 'max-retries' }])
    console_.expectLogged('[FakeWire] Giving up after 3 consecutive reconnect failures')
    console_.restore()
    const socketsAtGiveUp = sockets.length

    // A close after termination neither reconnects nor re-fires the terminal.
    lastSocket(sockets).simulateClose({ code: 1006 })
    await Promise.resolve()
    expect(sockets).toHaveLength(socketsAtGiveUp)
    expect(terminals).toHaveLength(1)
  })

  it('resets the failure count after a successful open (flaky link never gives up)', async () => {
    const terminals: { reason: string }[] = []
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, {
      sleep: instantSleep,
      maxConsecutiveFailures: 2,
      onTerminal: (state) => terminals.push(state),
    })

    stream.start()
    // Many close/open cycles: each open resets the tally, so we never hit 2.
    for (let i = 0; i < 6; i++) {
      lastSocket(sockets).simulateOpen()
      lastSocket(sockets).simulateClose({ code: 1006 })
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(terminals).toHaveLength(0)
  })

  it('treats a handshake error carrying HTTP 401 as a permanent auth failure', async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    const terminals: { reason: string }[] = []
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, {
      sleep,
      onTerminal: (state) => terminals.push(state),
    })
    const console_ = captureConsole()

    stream.start()
    lastSocket(sockets).simulateError('Unexpected server response: 401')
    await Promise.resolve()

    expect(terminals).toEqual([{ reason: 'auth' }])
    expect(delays).toHaveLength(0)
    expect(sockets).toHaveLength(1)
    console_.expectLogged('[FakeWire] Socket error', 'authentication rejected')
    console_.restore()
  })

  it('completes the spans() iterator when it terminates on auth failure', async () => {
    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })
    const console_ = captureConsole()

    stream.start()
    lastSocket(sockets).simulateOpen()

    const seen: TranscriptSpan[] = []
    const iterPromise = (async () => {
      for await (const span of stream.spans()) seen.push(span)
    })()

    lastSocket(sockets).simulateClose({ code: 4001 })
    await iterPromise // must resolve, not hang
    expect(seen).toHaveLength(0)
    console_.expectLogged('[FakeWire] Socket closed', 'authentication rejected')
    console_.restore()
  })

  it('never logs the transcript text on any lifecycle event', async () => {
    const logs: string[] = []
    for (const level of ['info', 'error', 'warn', 'log'] as const) {
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(' '))
      })
    }

    const { wire, sockets } = makeFakeWire()
    const stream = new RealtimeSpanStream(wire, { sleep: instantSleep })

    stream.start()
    const socket = lastSocket(sockets)
    socket.simulateOpen()
    socket.simulateMessage({ text: 'geheime inhoud' })
    socket.simulateError()
    socket.simulateClose()
    await Promise.resolve()

    expect(logs.join('\n')).not.toContain('geheime inhoud')
    vi.restoreAllMocks()
  })
})
