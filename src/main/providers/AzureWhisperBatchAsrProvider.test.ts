/**
 * Tests for AzureWhisperBatchAsrProvider (Phase 3.3).
 *
 * fetch is injected, so no real network. Import-only (streaming methods throw).
 * Azure speaks the same transcription response shape as OpenAI but differs in:
 *   - URL: {endpoint}/openai/deployments/{deployment}/audio/transcriptions
 *          ?api-version=…
 *   - Auth: the `api-key` header (not Authorization: Bearer)
 */

import { describe, expect, it, vi } from 'vitest'

import { AzureWhisperBatchAsrProvider } from './AzureWhisperBatchAsrProvider'

const pcm = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0])

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(json) } as unknown as Response
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response
}

function makeProvider(fetchImpl: typeof globalThis.fetch) {
  return new AzureWhisperBatchAsrProvider({
    apiKey: 'azure-test',
    endpoint: 'https://my-resource.openai.azure.com/',
    deployment: 'whisper',
    apiVersion: '2024-06-01',
    model: 'whisper',
    language: 'nl',
    displayName: 'Azure',
    fetch: fetchImpl,
  })
}

describe('AzureWhisperBatchAsrProvider.transcribeBatch', () => {
  it('maps verbose_json segments to time-ordered final spans', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        text: 'hallo wereld',
        segments: [
          { start: 0, end: 1, text: 'hallo' },
          { start: 1, end: 2, text: 'wereld' },
        ],
      }),
    )
    const provider = makeProvider(fetchMock)

    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(2)
    expect(spans[0]?.text).toBe('hallo')
    expect(spans[1]?.endMs).toBe(2000)
    expect(spans.every((s) => s.isFinal === true)).toBe(true)
  })

  it('targets the Azure deployment transcription URL with the api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'x', segments: [] }))
    const provider = makeProvider(fetchMock)

    await provider.transcribeBatch(pcm)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://my-resource.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2024-06-01',
    )
    const headers = init.headers as Record<string, string>
    expect(headers['api-key']).toBe('azure-test')
    expect(headers).not.toHaveProperty('Authorization')
  })

  it('degrades to a single span when only text is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'hele transcriptie' }))
    const provider = makeProvider(fetchMock)

    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('hele transcriptie')
  })

  it('throws on a non-ok HTTP response', async () => {
    const provider = makeProvider(vi.fn().mockResolvedValue(errorResponse(403)))
    await expect(provider.transcribeBatch(pcm)).rejects.toThrow(/403/)
  })
})

describe('AzureWhisperBatchAsrProvider streaming methods (import-only)', () => {
  it('throws "not yet implemented" for the live streaming methods', () => {
    const provider = makeProvider(vi.fn())
    expect(() => provider.start()).toThrow(/not yet implemented/i)
    expect(() => provider.spans()).toThrow(/not yet implemented/i)
  })
})
