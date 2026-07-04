/**
 * Tests for MistralVoxtralRealtimeAsrProvider (Phase 4.3).
 *
 * Voxtral Realtime is a distinct WebSocket wire (ADR 0028: ASR has no shared
 * realtime protocol across vendors). The socket is mocked via an injected
 * factory; tests script Voxtral transcription events (delta = interim, final =
 * final) and assert the distinctive bits: diarization speaker labels, segment
 * timing, and binary audio frames.
 */

import { describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import { FakeClock } from '@shared/providers'

import type { WebSocketLike } from './DeepgramAsrProvider'
import {
  MistralVoxtralRealtimeAsrProvider,
  type MistralRealtimeWebSocketFactory,
} from './MistralVoxtralRealtimeAsrProvider'

class FakeWebSocket {
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onclose: (() => void) | null = null

  sentText: string[] = []
  sentBinary: Uint8Array[] = []

  send(data: Uint8Array | string): void {
    if (typeof data === 'string') this.sentText.push(data)
    else this.sentBinary.push(data)
  }
  close(): void {
    this.readyState = 3
  }
  simulateOpen(): void {
    this.onopen?.()
  }
  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
  simulateClose(): void {
    this.readyState = 3
    this.onclose?.()
  }
  sentObjects(): Record<string, unknown>[] {
    return this.sentText.map((t) => JSON.parse(t) as Record<string, unknown>)
  }
}

const instantSleep = () => Promise.resolve()

let currentSocket: FakeWebSocket
let lastWsUrl = ''
let lastWsOptions: { headers?: Record<string, string> } | undefined

function makeProvider() {
  currentSocket = new FakeWebSocket()
  const factory: MistralRealtimeWebSocketFactory = (url, options) => {
    lastWsUrl = url
    lastWsOptions = options
    return currentSocket
  }
  return new MistralVoxtralRealtimeAsrProvider({
    apiKey: 'test-key',
    model: 'voxtral-mini-2507',
    language: 'nl',
    sleep: instantSleep,
    maxBackoffMs: 30_000,
    clock: new FakeClock(0),
    webSocketFactory: factory,
  })
}

async function collectN(
  provider: MistralVoxtralRealtimeAsrProvider,
  n: number,
): Promise<TranscriptSpan[]> {
  const result: TranscriptSpan[] = []
  for await (const span of provider.spans()) {
    result.push(span)
    if (result.length >= n) break
  }
  return result
}

function deltaEvent(text: string): unknown {
  return { type: 'transcript.delta', text }
}

function finalEvent(opts: {
  text: string
  start?: number
  end?: number
  speaker?: number
}): unknown {
  return { type: 'transcript.final', ...opts }
}

describe('MistralVoxtralRealtimeAsrProvider', () => {
  it('connects to the Voxtral realtime endpoint with a Bearer auth header', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    expect(lastWsUrl).toContain('mistral.ai')
    expect(lastWsOptions?.headers?.Authorization).toBe('Bearer test-key')
  })

  it('configures the session with model + language on open', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const config = currentSocket.sentObjects()[0]
    expect(config?.model).toBe('voxtral-mini-2507')
    expect(config?.language).toBe('nl')
  })

  it('emits an interim span from a transcript.delta event', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)
    currentSocket.simulateMessage(deltaEvent('Hal'))

    const spans = await collectPromise
    expect(spans[0]?.text).toBe('Hal')
    expect(spans[0]?.isFinal).toBe(false)
  })

  it('emits a final span from a transcript.final event with diarization + timing', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const collectPromise = collectN(provider, 1)
    currentSocket.simulateMessage(
      finalEvent({ text: 'Hallo allemaal', start: 2.5, end: 4, speaker: 1 }),
    )

    const spans = await collectPromise
    expect(spans[0]).toMatchObject({
      text: 'Hallo allemaal',
      startMs: 2500,
      endMs: 4000,
      speakerLabel: 'Speaker 1',
      isFinal: true,
    })
  })

  it('sends audio frames as binary over the WebSocket after start()', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const frame = new Uint8Array([0x01, 0x02, 0x03])
    provider.pushAudioFrame(frame)

    expect(currentSocket.sentBinary).toHaveLength(1)
    expect(currentSocket.sentBinary[0]).toEqual(frame)
  })

  it('reconnects after a socket drop and continues emitting spans', async () => {
    let socketIndex = 0
    const sockets: FakeWebSocket[] = [new FakeWebSocket(), new FakeWebSocket()]

    const provider = new MistralVoxtralRealtimeAsrProvider({
      apiKey: 'test-key',
      model: 'voxtral-mini-2507',
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
    const first = sockets[0]
    if (first === undefined) throw new Error('expected sockets[0]')
    first.simulateOpen()

    const collectPromise = collectN(provider, 2)
    first.simulateMessage(finalEvent({ text: 'Eerste' }))
    first.simulateClose()

    await Promise.resolve()
    const second = sockets[1]
    if (second === undefined) throw new Error('expected sockets[1]')
    second.simulateOpen()
    second.simulateMessage(finalEvent({ text: 'Na reconnect' }))

    const spans = await collectPromise
    expect(spans.map((s) => s.text)).toEqual(['Eerste', 'Na reconnect'])
  })

  it('stops the spans() iterator after stop() is called', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const spans: TranscriptSpan[] = []
    const iterPromise = (async () => {
      for await (const span of provider.spans()) spans.push(span)
    })()

    currentSocket.simulateMessage(finalEvent({ text: 'Stop test' }))
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
    currentSocket.simulateMessage(finalEvent({ text: 'Geheime inhoud' }))
    currentSocket.simulateClose()
    await Promise.resolve()

    const all = logged.join('\n')
    expect(all).not.toContain('test-key')
    expect(all).not.toContain('Geheime inhoud')
    expect(all).not.toContain('deadbeef')

    for (const s of spies) s.mockRestore()
  })
})
