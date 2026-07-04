/**
 * Tests for the Azure OpenAI realtime reuse (Phase 4.2).
 *
 * Azure OpenAI speaks the same Realtime transcription wire as OpenAI, so there
 * is no new adapter: createAzureOpenAIRealtimeAsrProvider builds an
 * OpenAIRealtimeAsrProvider with an Azure connection (deployment URL + `api-key`
 * header). These tests prove the URL/auth assembly and that the shared frame
 * handling still produces spans.
 */

import { describe, expect, it } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import { FakeClock } from '@shared/providers'

import { createAzureOpenAIRealtimeAsrProvider } from './AzureOpenAIRealtimeAsrProvider'
import type { OpenAIRealtimeAsrProvider } from './OpenAIRealtimeAsrProvider'

class FakeWebSocket {
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onclose: (() => void) | null = null
  sentText: string[] = []

  send(data: Uint8Array | string): void {
    if (typeof data === 'string') this.sentText.push(data)
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
  sentObjects(): Record<string, unknown>[] {
    return this.sentText.map((t) => JSON.parse(t) as Record<string, unknown>)
  }
}

let currentSocket: FakeWebSocket
let lastWsUrl = ''
let lastWsOptions: { headers?: Record<string, string> } | undefined

function makeProvider() {
  currentSocket = new FakeWebSocket()
  return createAzureOpenAIRealtimeAsrProvider({
    apiKey: 'azure-key',
    endpoint: 'https://my-resource.openai.azure.com/',
    deployment: 'gpt-4o-transcribe-rt',
    apiVersion: '2024-10-01-preview',
    model: 'gpt-4o-transcribe',
    language: 'nl',
    clock: new FakeClock(0),
    webSocketFactory: (url, options) => {
      lastWsUrl = url
      lastWsOptions = options
      return currentSocket
    },
  })
}

async function firstSpan(provider: OpenAIRealtimeAsrProvider): Promise<TranscriptSpan> {
  for await (const span of provider.spans()) return span
  throw new Error('no span produced')
}

describe('createAzureOpenAIRealtimeAsrProvider', () => {
  it('connects to the Azure realtime deployment URL with the api-key header', () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    expect(lastWsUrl).toContain('wss://my-resource.openai.azure.com/openai/realtime')
    expect(lastWsUrl).toContain('api-version=2024-10-01-preview')
    expect(lastWsUrl).toContain('deployment=gpt-4o-transcribe-rt')
    expect(lastWsUrl).toContain('intent=transcription')
    expect(lastWsOptions?.headers?.['api-key']).toBe('azure-key')
    // Azure uses api-key, never a Bearer Authorization header.
    expect(lastWsOptions?.headers?.Authorization).toBeUndefined()
  })

  it('configures the session and produces spans over the shared frame handling', async () => {
    const provider = makeProvider()
    provider.start()
    currentSocket.simulateOpen()

    const update = currentSocket
      .sentObjects()
      .find((o) => o.type === 'transcription_session.update')
    expect(update).toBeDefined()

    const spanPromise = firstSpan(provider)
    currentSocket.simulateMessage({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hallo vanuit Azure',
    })

    const span = await spanPromise
    expect(span.text).toBe('Hallo vanuit Azure')
    expect(span.isFinal).toBe(true)
  })
})
