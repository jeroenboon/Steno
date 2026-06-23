/**
 * Tests for DeepgramAsrProvider (item 0011).
 *
 * The WebSocket is mocked entirely via an injected factory — no real network
 * calls, no real API key. Tests drive the provider through the ASRProvider
 * public interface only.
 *
 * ## Behaviours tested
 *
 * - Tracer bullet: a single final-result span is emitted
 * - Interim (is_final=false) and final (is_final=true) spans emitted in order
 * - Confidence extracted from the channel alternative
 * - Speaker labels emitted when diarization payload includes them
 * - Reconnect after socket close resumes span emission (backoff fires)
 * - Backoff is bounded (never exceeds the configured cap)
 * - Audio frames are forwarded over the socket
 * - Principle #12: no audio bytes, transcript text, or API key appear in logs
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'

import { DeepgramAsrProvider, type WebSocketLike } from './DeepgramAsrProvider'

// ---------------------------------------------------------------------------
// Fake WebSocket
// ---------------------------------------------------------------------------

/**
 * Minimal mock of the browser/Node WebSocket interface.
 * We keep only what DeepgramAsrProvider needs.
 */
class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState: number = FakeWebSocket.OPEN

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onclose: (() => void) | null = null

  sentFrames: Uint8Array[] = []
  closed = false

  send(data: Uint8Array | string): void {
    if (data instanceof Uint8Array) {
      this.sentFrames.push(data)
    }
  }

  close(): void {
    this.closed = true
    this.readyState = FakeWebSocket.CLOSED
  }

  /** Test helper: simulate the server sending a message. */
  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  /** Test helper: fire the open event. */
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  /** Test helper: simulate a socket drop. */
  simulateClose(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  /** Test helper: simulate a socket error (triggers reconnect too). */
  simulateError(message: string): void {
    this.onerror?.({ message })
  }
}

// ---------------------------------------------------------------------------
// Deepgram payload builders
// ---------------------------------------------------------------------------

/** Build a Deepgram-style transcript result message. */
function makeDeepgramResult(opts: {
  transcript: string
  isFinal: boolean
  startSec?: number
  endSec?: number
  confidence?: number
  speakerLabel?: string
}): unknown {
  const word =
    opts.speakerLabel !== undefined
      ? { word: opts.transcript, speaker: Number(opts.speakerLabel.replace('Speaker ', '')) }
      : undefined

  const alternative: Record<string, unknown> = {
    transcript: opts.transcript,
    confidence: opts.confidence ?? 0.9,
  }
  if (word !== undefined) {
    alternative.words = [word]
  }

  return {
    type: 'Results',
    channel: { alternatives: [alternative] },
    is_final: opts.isFinal,
    start: opts.startSec ?? 0,
    duration: (opts.endSec ?? 1) - (opts.startSec ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/** Instant sleep — resolves synchronously so tests need no real timer waits. */
const instantSleep = () => Promise.resolve()

let currentSocket: FakeWebSocket
let lastWsUrl = ''

function makeProvider(overrides?: { maxBackoffMs?: number }) {
  currentSocket = new FakeWebSocket()

  const factory = (url: string) => {
    lastWsUrl = url
    return currentSocket as unknown as WebSocketLike
  }

  return new DeepgramAsrProvider({
    apiKey: 'test-key',
    language: 'nl',
    sleep: instantSleep,
    maxBackoffMs: overrides?.maxBackoffMs ?? 30_000,
    webSocketFactory: factory,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect N spans from the provider's spans() iterator. */
async function collectN(provider: DeepgramAsrProvider, n: number): Promise<TranscriptSpan[]> {
  const result: TranscriptSpan[] = []
  for await (const span of provider.spans()) {
    result.push(span)
    if (result.length >= n) break
  }
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeepgramAsrProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // nothing to clean up — fake sockets don't hold real resources
  })

  // -------------------------------------------------------------------------
  // Tracer bullet: single final span
  // -------------------------------------------------------------------------

  it('connects to the streaming endpoint with the nova-3 model', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    expect(lastWsUrl).toContain('model=nova-3')
  })

  it('emits a span when the socket delivers a final Deepgram result', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)

    currentSocket.simulateMessage(makeDeepgramResult({ transcript: 'Hallo wereld', isFinal: true }))

    const spans = await collectPromise
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('Hallo wereld')
    expect(spans[0]?.isFinal).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Interim + final spans emitted in order
  // -------------------------------------------------------------------------

  it('emits interim span (isFinal=false) before the final span (isFinal=true)', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 2)

    currentSocket.simulateMessage(
      makeDeepgramResult({ transcript: 'Hal', isFinal: false, startSec: 0, endSec: 0.5 }),
    )
    currentSocket.simulateMessage(
      makeDeepgramResult({ transcript: 'Hallo', isFinal: true, startSec: 0, endSec: 1 }),
    )

    const spans = await collectPromise
    expect(spans).toHaveLength(2)
    expect(spans[0]?.isFinal).toBe(false)
    expect(spans[0]?.text).toBe('Hal')
    expect(spans[1]?.isFinal).toBe(true)
    expect(spans[1]?.text).toBe('Hallo')
  })

  // -------------------------------------------------------------------------
  // Confidence surfaced
  // -------------------------------------------------------------------------

  it('maps Deepgram channel confidence to TranscriptSpan.confidence', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)

    currentSocket.simulateMessage(
      makeDeepgramResult({ transcript: 'Test', isFinal: true, confidence: 0.97 }),
    )

    const spans = await collectPromise
    expect(spans[0]?.confidence).toBeCloseTo(0.97)
  })

  // -------------------------------------------------------------------------
  // Speaker labels
  // -------------------------------------------------------------------------

  it('maps Deepgram diarization speaker to speakerLabel when present', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)

    currentSocket.simulateMessage(
      makeDeepgramResult({
        transcript: 'Ik ben spreker nul',
        isFinal: true,
        speakerLabel: 'Speaker 0',
      }),
    )

    const spans = await collectPromise
    expect(spans[0]?.speakerLabel).toBe('Speaker 0')
  })

  it('omits speakerLabel when diarization payload has no words', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)

    currentSocket.simulateMessage(makeDeepgramResult({ transcript: 'Geen spreker', isFinal: true }))

    const spans = await collectPromise
    expect(spans[0]?.speakerLabel).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Timestamps
  // -------------------------------------------------------------------------

  it('converts Deepgram start/duration (seconds) to startMs/endMs (milliseconds)', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)

    currentSocket.simulateMessage(
      makeDeepgramResult({
        transcript: 'Tijdstempel test',
        isFinal: true,
        startSec: 2.5,
        endSec: 4.0,
      }),
    )

    const spans = await collectPromise
    expect(spans[0]?.startMs).toBe(2500)
    expect(spans[0]?.endMs).toBe(4000)
  })

  // -------------------------------------------------------------------------
  // Audio frames forwarded
  // -------------------------------------------------------------------------

  it('sends audio frames over the WebSocket after start()', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const frame = new Uint8Array([0x01, 0x02, 0x03])
    provider.pushAudioFrame(frame)

    expect(currentSocket.sentFrames).toHaveLength(1)
    expect(currentSocket.sentFrames[0]).toEqual(frame)
  })

  // -------------------------------------------------------------------------
  // Reconnect after socket drop
  // -------------------------------------------------------------------------

  it('reconnects after a socket drop and continues emitting spans', async () => {
    let socketIndex = 0
    const sockets: FakeWebSocket[] = [new FakeWebSocket(), new FakeWebSocket()]

    const provider = new DeepgramAsrProvider({
      apiKey: 'test-key',
      language: 'nl',
      sleep: instantSleep,
      maxBackoffMs: 30_000,
      webSocketFactory: () => {
        const s = sockets[socketIndex]
        socketIndex++
        return s as unknown as WebSocketLike
      },
    })

    provider.start()
    const firstSocket = sockets[0]
    if (firstSocket === undefined) throw new Error('expected sockets[0]')
    firstSocket.simulateOpen()

    const collectPromise = collectN(provider, 2)

    // First span on original socket
    firstSocket.simulateMessage(makeDeepgramResult({ transcript: 'Eerste span', isFinal: true }))

    // Simulate socket drop — provider should reconnect
    firstSocket.simulateClose()

    // Open the new socket and deliver a second span
    await Promise.resolve() // yield to allow reconnect logic to run
    const secondSocket = sockets[1]
    if (secondSocket === undefined) throw new Error('expected sockets[1]')
    secondSocket.simulateOpen()
    secondSocket.simulateMessage(makeDeepgramResult({ transcript: 'Na reconnect', isFinal: true }))

    const spans = await collectPromise
    expect(spans).toHaveLength(2)
    expect(spans[0]?.text).toBe('Eerste span')
    expect(spans[1]?.text).toBe('Na reconnect')
  })

  // -------------------------------------------------------------------------
  // Backoff is bounded
  // -------------------------------------------------------------------------

  it('caps backoff delay at maxBackoffMs', async () => {
    const sleepDelays: number[] = []
    const fakeSleep = (ms: number) => {
      sleepDelays.push(ms)
      return Promise.resolve()
    }

    let socketIndex = 0
    // 10 sockets: first is the initial connection; rest are reconnects
    const sockets = Array.from({ length: 10 }, () => new FakeWebSocket())

    const provider = new DeepgramAsrProvider({
      apiKey: 'test-key',
      language: 'nl',
      sleep: fakeSleep,
      maxBackoffMs: 4_000, // low cap so we hit it quickly
      webSocketFactory: () => {
        const s = sockets[socketIndex]
        socketIndex++
        return s as unknown as WebSocketLike
      },
    })

    provider.start()
    const sock0 = sockets[0]
    if (sock0 === undefined) throw new Error('expected sockets[0]')
    sock0.simulateOpen()

    // Drop the socket 6 times in sequence, each time letting the reconnect proceed
    for (let i = 0; i < 6; i++) {
      const current = sockets[i]
      const next = sockets[i + 1]
      if (current === undefined || next === undefined)
        throw new Error(`expected sockets[${String(i)}]`)
      current.simulateClose()
      await Promise.resolve() // let reconnect schedule
      next.simulateOpen()
      await Promise.resolve()
    }

    // All delays after the first few should be capped
    const exceedsCap = sleepDelays.some((d) => d > 4_000)
    expect(exceedsCap).toBe(false)
    expect(sleepDelays.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // stop() completes the iterator
  // -------------------------------------------------------------------------

  it('stops the spans() iterator after stop() is called', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const spans: TranscriptSpan[] = []
    const iterPromise = (async () => {
      for await (const span of provider.spans()) {
        spans.push(span)
      }
    })()

    // Deliver one span, then stop
    currentSocket.simulateMessage(makeDeepgramResult({ transcript: 'Stop test', isFinal: true }))
    await Promise.resolve()
    provider.stop()

    await iterPromise // must resolve, not hang
    expect(spans.length).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // Principle #12: no audio/content/key in logs
  // -------------------------------------------------------------------------

  it('does not log the API key, audio frames, or transcript text', async () => {
    const loggedStrings: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      loggedStrings.push(args.map(String).join(' '))
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      loggedStrings.push(args.map(String).join(' '))
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      loggedStrings.push(args.map(String).join(' '))
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      loggedStrings.push(args.map(String).join(' '))
    })

    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()
    provider.pushAudioFrame(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))

    currentSocket.simulateMessage(
      makeDeepgramResult({ transcript: 'Geheime inhoud', isFinal: true }),
    )
    // Trigger a reconnect (logs a reconnect notice — should NOT include the key)
    currentSocket.simulateClose()
    await Promise.resolve()

    const allLogs = loggedStrings.join('\n')
    expect(allLogs).not.toContain('test-key')
    expect(allLogs).not.toContain('Geheime inhoud')
    // Binary audio bytes should not appear as text either
    expect(allLogs).not.toContain('deadbeef')

    errorSpy.mockRestore()
    warnSpy.mockRestore()
    infoSpy.mockRestore()
    logSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// transcribeBatch — prerecorded REST (item 0026)
// ---------------------------------------------------------------------------

describe('DeepgramAsrProvider.transcribeBatch', () => {
  function okResponse(body: unknown): Response {
    return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
  }

  function makeBatchProvider(fetchImpl: typeof globalThis.fetch) {
    return new DeepgramAsrProvider({ apiKey: 'test-key', language: 'nl', fetch: fetchImpl })
  }

  const utterancesBody = {
    metadata: { duration: 3 },
    results: {
      utterances: [
        { start: 0, end: 1.5, transcript: 'Hallo allemaal', speaker: 0, confidence: 0.9 },
        { start: 1.5, end: 3, transcript: 'We beginnen met de begroting', speaker: 1 },
      ],
    },
  }

  it('maps prerecorded utterances to time-ordered spans with speaker labels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(utterancesBody))
    const provider = makeBatchProvider(fetchMock)

    const spans = await provider.transcribeBatch(new Uint8Array([1, 2, 3, 4]))

    expect(spans.map((s) => s.text)).toEqual(['Hallo allemaal', 'We beginnen met de begroting'])
    expect(spans[0]).toMatchObject({
      startMs: 0,
      endMs: 1500,
      speakerLabel: 'Speaker 0',
      isFinal: true,
    })
    expect(spans[1]).toMatchObject({ startMs: 1500, endMs: 3000, speakerLabel: 'Speaker 1' })
  })

  it('POSTs the PCM to the prerecorded endpoint with token auth and linear16 params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(utterancesBody))
    const provider = makeBatchProvider(fetchMock)

    await provider.transcribeBatch(new Uint8Array([1, 2, 3, 4]))

    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toContain('api.deepgram.com/v1/listen')
    expect(call[0]).toContain('model=nova-3')
    expect(call[0]).toContain('encoding=linear16')
    expect(call[0]).toContain('sample_rate=16000')
    const headers = call[1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Token test-key')
    expect(call[1].method).toBe('POST')
  })

  it('falls back to the channel transcript when no utterances are present', async () => {
    const body = {
      metadata: { duration: 2 },
      results: { channels: [{ alternatives: [{ transcript: 'Korte notitie', confidence: 0.8 }] }] },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body))
    const provider = makeBatchProvider(fetchMock)

    const spans = await provider.transcribeBatch(new Uint8Array([1, 2]))

    expect(spans.map((s) => s.text)).toEqual(['Korte notitie'])
    expect(spans[0]).toMatchObject({ startMs: 0, endMs: 2000 })
  })

  it('throws on a non-ok response without logging the key', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '))
    })
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const provider = makeBatchProvider(fetchMock)

    await expect(provider.transcribeBatch(new Uint8Array([1, 2]))).rejects.toThrow()
    expect(logged.join('\n')).not.toContain('test-key')

    errorSpy.mockRestore()
  })
})
