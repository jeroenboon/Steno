/**
 * Tests for OpenAIRealtimeAsrProvider (Phase 4.1).
 *
 * The WebSocket is mocked via an injected factory — no real network, no real
 * key. Tests drive the provider through the ASRProvider public interface and
 * script the OpenAI Realtime transcription events (delta = interim, completed =
 * final).
 *
 * ## Behaviours tested
 * - Connects to the realtime transcription endpoint with a Bearer auth header
 *   and configures the session (transcription_session.update) on open.
 * - Emits an interim span from a transcription `delta` event (isFinal=false).
 * - Emits a final span from a transcription `completed` event (isFinal=true).
 * - Interim arrives before final, in order.
 * - Audio frames are sent as base64 input_audio_buffer.append after start().
 * - Reconnects after a socket drop and continues emitting spans (backoff fires).
 * - Backoff is bounded by maxBackoffMs.
 * - stop() completes the spans() iterator.
 * - Principle #12: no API key, audio bytes, or transcript text appear in logs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import { FakeClock } from '@shared/providers'

import type { WebSocketLike } from './DeepgramAsrProvider'
import {
  OpenAIRealtimeAsrProvider,
  type RealtimeWebSocketFactory,
} from './OpenAIRealtimeAsrProvider'

// ---------------------------------------------------------------------------
// Fake WebSocket
// ---------------------------------------------------------------------------

class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState: number = FakeWebSocket.OPEN

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onclose: (() => void) | null = null

  /** All text (JSON) frames the provider sent. */
  sentText: string[] = []
  closed = false

  send(data: Uint8Array | string): void {
    if (typeof data === 'string') this.sentText.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeWebSocket.CLOSED
  }

  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  simulateClose(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  simulateError(message: string): void {
    this.onerror?.({ message })
  }

  /** Parse every sent frame as JSON for assertions. */
  sentObjects(): Record<string, unknown>[] {
    return this.sentText.map((t) => JSON.parse(t) as Record<string, unknown>)
  }
}

// ---------------------------------------------------------------------------
// Event builders (OpenAI Realtime transcription)
// ---------------------------------------------------------------------------

function deltaEvent(delta: string): unknown {
  return { type: 'conversation.item.input_audio_transcription.delta', delta }
}

function completedEvent(transcript: string): unknown {
  return { type: 'conversation.item.input_audio_transcription.completed', transcript }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

const instantSleep = () => Promise.resolve()

let currentSocket: FakeWebSocket
let lastWsUrl = ''
let lastWsOptions: { headers?: Record<string, string>; protocols?: string | string[] } | undefined

function makeProvider(overrides?: { maxBackoffMs?: number }) {
  currentSocket = new FakeWebSocket()

  const factory: RealtimeWebSocketFactory = (url, options) => {
    lastWsUrl = url
    lastWsOptions = options
    return currentSocket
  }

  return new OpenAIRealtimeAsrProvider({
    apiKey: 'test-key',
    model: 'gpt-4o-transcribe',
    language: 'nl',
    sleep: instantSleep,
    maxBackoffMs: overrides?.maxBackoffMs ?? 30_000,
    clock: new FakeClock(0),
    webSocketFactory: factory,
  })
}

async function collectN(provider: OpenAIRealtimeAsrProvider, n: number): Promise<TranscriptSpan[]> {
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

describe('OpenAIRealtimeAsrProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    lastWsOptions = undefined
  })

  it('connects to the realtime transcription endpoint with a Bearer auth header', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    expect(lastWsUrl).toContain('api.openai.com/v1/realtime')
    expect(lastWsUrl).toContain('intent=transcription')
    expect(lastWsOptions?.headers?.Authorization).toBe('Bearer test-key')
  })

  it('configures the transcription session with the model on open', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const update = currentSocket
      .sentObjects()
      .find((o) => o.type === 'transcription_session.update')
    expect(update).toBeDefined()
    const session = update?.session as Record<string, unknown> | undefined
    const transcription = session?.input_audio_transcription as Record<string, unknown> | undefined
    expect(transcription?.model).toBe('gpt-4o-transcribe')
    expect(transcription?.language).toBe('nl')
  })

  it('emits an interim span from a transcription delta event', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)
    currentSocket.simulateMessage(deltaEvent('Hal'))

    const spans = await collectPromise
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('Hal')
    expect(spans[0]?.isFinal).toBe(false)
  })

  it('emits a final span from a transcription completed event', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)
    currentSocket.simulateMessage(completedEvent('Hallo wereld'))

    const spans = await collectPromise
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('Hallo wereld')
    expect(spans[0]?.isFinal).toBe(true)
  })

  it('emits the interim span before the final span, in order', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 2)
    currentSocket.simulateMessage(deltaEvent('Hal'))
    currentSocket.simulateMessage(completedEvent('Hallo'))

    const spans = await collectPromise
    expect(spans[0]?.isFinal).toBe(false)
    expect(spans[0]?.text).toBe('Hal')
    expect(spans[1]?.isFinal).toBe(true)
    expect(spans[1]?.text).toBe('Hallo')
  })

  it('sends audio frames as base64 input_audio_buffer.append after start()', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    provider.pushAudioFrame(new Uint8Array([0x01, 0x02, 0x03]))

    const append = currentSocket.sentObjects().find((o) => o.type === 'input_audio_buffer.append')
    expect(append).toBeDefined()
    expect(append?.audio).toBe(Buffer.from([0x01, 0x02, 0x03]).toString('base64'))
  })

  it('reconnects after a socket drop and continues emitting spans', async () => {
    let socketIndex = 0
    const sockets: FakeWebSocket[] = [new FakeWebSocket(), new FakeWebSocket()]

    const provider = new OpenAIRealtimeAsrProvider({
      apiKey: 'test-key',
      model: 'gpt-4o-transcribe',
      language: 'nl',
      sleep: instantSleep,
      maxBackoffMs: 30_000,
      clock: new FakeClock(0),
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
    firstSocket.simulateMessage(completedEvent('Eerste'))
    firstSocket.simulateClose()

    await Promise.resolve()
    const secondSocket = sockets[1]
    if (secondSocket === undefined) throw new Error('expected sockets[1]')
    secondSocket.simulateOpen()
    secondSocket.simulateMessage(completedEvent('Na reconnect'))

    const spans = await collectPromise
    expect(spans.map((s) => s.text)).toEqual(['Eerste', 'Na reconnect'])
  })

  it('caps backoff delay at maxBackoffMs', async () => {
    const sleepDelays: number[] = []
    const fakeSleep = (ms: number) => {
      sleepDelays.push(ms)
      return Promise.resolve()
    }

    let socketIndex = 0
    const sockets = Array.from({ length: 10 }, () => new FakeWebSocket())

    const provider = new OpenAIRealtimeAsrProvider({
      apiKey: 'test-key',
      model: 'gpt-4o-transcribe',
      language: 'nl',
      sleep: fakeSleep,
      maxBackoffMs: 4_000,
      clock: new FakeClock(0),
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

    for (let i = 0; i < 6; i++) {
      const current = sockets[i]
      const next = sockets[i + 1]
      if (current === undefined || next === undefined)
        throw new Error(`expected sockets[${String(i)}]`)
      current.simulateClose()
      await Promise.resolve()
      next.simulateOpen()
      await Promise.resolve()
    }

    expect(sleepDelays.some((d) => d > 4_000)).toBe(false)
    expect(sleepDelays.length).toBeGreaterThan(0)
  })

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

    currentSocket.simulateMessage(completedEvent('Stop test'))
    await Promise.resolve()
    provider.stop()

    await iterPromise
    expect(spans.length).toBeGreaterThanOrEqual(1)
  })

  it('does not log the API key, audio frames, or transcript text', async () => {
    const logged: string[] = []
    const spies = (['error', 'warn', 'info', 'log'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      }),
    )

    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()
    provider.pushAudioFrame(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    currentSocket.simulateMessage(completedEvent('Geheime inhoud'))
    currentSocket.simulateClose()
    await Promise.resolve()

    const all = logged.join('\n')
    expect(all).not.toContain('test-key')
    expect(all).not.toContain('Geheime inhoud')
    expect(all).not.toContain('deadbeef')

    for (const s of spies) s.mockRestore()
  })
})
