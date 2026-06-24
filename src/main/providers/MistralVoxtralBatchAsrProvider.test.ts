/**
 * Tests for MistralVoxtralBatchAsrProvider (Phase 3.2).
 *
 * fetch is injected, so no real network. Like the OpenAI batch adapter this is
 * import-only (streaming methods throw). What is Mistral-specific and tested:
 *   - Voxtral diarization maps onto speakerLabel ("Speaker N") so the
 *     Speaker-label → Participant flow lights up on import
 *   - segments map to time-ordered final spans; text-only degrades to one span
 *   - the request targets Mistral's /audio/transcriptions with the model
 */

import { describe, expect, it, vi } from 'vitest'

import { MistralVoxtralBatchAsrProvider } from './MistralVoxtralBatchAsrProvider'

const pcm = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0])

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(json) } as unknown as Response
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response
}

function makeProvider(fetchImpl: typeof globalThis.fetch) {
  return new MistralVoxtralBatchAsrProvider({
    apiKey: 'mistral-test',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'voxtral-mini-2507',
    language: 'nl',
    displayName: 'Mistral',
    fetch: fetchImpl,
  })
}

describe('MistralVoxtralBatchAsrProvider.transcribeBatch', () => {
  it('maps diarized segments to spans with speaker labels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        text: 'hallo daar',
        segments: [
          { start: 0, end: 1, text: 'hallo', speaker: 0 },
          { start: 1, end: 2, text: 'daar', speaker: 1 },
        ],
      }),
    )
    const provider = makeProvider(fetchMock)

    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(2)
    expect(spans[0]?.speakerLabel).toBe('Speaker 0')
    expect(spans[1]?.speakerLabel).toBe('Speaker 1')
    expect(spans[0]?.startMs).toBe(0)
    expect(spans[1]?.endMs).toBe(2000)
    expect(spans.every((s) => s.isFinal === true)).toBe(true)
  })

  it('targets Mistral /audio/transcriptions with the model and Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'x', segments: [] }))
    const provider = makeProvider(fetchMock)

    await provider.transcribeBatch(pcm)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.mistral.ai/v1/audio/transcriptions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer mistral-test')
    const form = init.body as FormData
    expect(form.get('model')).toBe('voxtral-mini-2507')
  })

  it('degrades to a single span when only text is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'hele transcriptie' }))
    const provider = makeProvider(fetchMock)

    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('hele transcriptie')
    expect(spans[0]?.speakerLabel).toBeUndefined()
  })

  it('throws on a non-ok HTTP response', async () => {
    const provider = makeProvider(vi.fn().mockResolvedValue(errorResponse(429)))
    await expect(provider.transcribeBatch(pcm)).rejects.toThrow(/429/)
  })
})

describe('MistralVoxtralBatchAsrProvider streaming methods (import-only)', () => {
  it('throws "not yet implemented" for the live streaming methods', () => {
    const provider = makeProvider(vi.fn())
    expect(() => provider.start()).toThrow(/not yet implemented/i)
    expect(() => provider.spans()).toThrow(/not yet implemented/i)
  })
})
