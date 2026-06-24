/**
 * Tests for OpenAIBatchAsrProvider (Phase 3.1).
 *
 * fetch is injected, so no real network. The provider is import-only: it
 * implements transcribeBatch against OpenAI's /audio/transcriptions endpoint and
 * the streaming methods throw "not yet implemented" (live ASR is a later phase).
 * What is tested:
 *   - verbose_json segments map to time-ordered final spans
 *   - a plain {text} response (no segments) degrades to a single span
 *   - the request targets /audio/transcriptions with the model + Bearer auth
 *   - a non-ok HTTP response throws so the import surfaces the failure
 *   - streaming methods throw; the key is never logged
 */

import { describe, expect, it, vi } from 'vitest'

import { OpenAIBatchAsrProvider } from './OpenAIBatchAsrProvider'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// 4 samples of 16-bit LE PCM (8 bytes).
const pcm = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0])

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(json),
  } as unknown as Response
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response
}

function makeProvider(fetchImpl: typeof globalThis.fetch) {
  return new OpenAIBatchAsrProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-transcribe',
    language: 'nl',
    displayName: 'OpenAI',
    fetch: fetchImpl,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIBatchAsrProvider.transcribeBatch', () => {
  it('maps verbose_json segments to time-ordered final spans', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        text: 'hallo wereld',
        segments: [
          { start: 0, end: 1.5, text: 'hallo' },
          { start: 1.5, end: 3, text: ' wereld' },
        ],
      }),
    )
    const provider = makeProvider(fetchMock)

    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(2)
    expect(spans[0]?.text).toBe('hallo')
    expect(spans[0]?.startMs).toBe(0)
    expect(spans[0]?.endMs).toBe(1500)
    expect(spans[1]?.text).toBe('wereld')
    expect(spans[1]?.startMs).toBe(1500)
    expect(spans[1]?.endMs).toBe(3000)
    expect(spans.every((s) => s.isFinal === true)).toBe(true)
  })

  it('targets /audio/transcriptions with the model and Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'x', segments: [] }))
    const provider = makeProvider(fetchMock)

    await provider.transcribeBatch(pcm)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
  })

  it('degrades to a single span when only text is returned (no segments)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ text: 'hele transcriptie' }))
    const provider = makeProvider(fetchMock)

    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('hele transcriptie')
    expect(spans[0]?.startMs).toBe(0)
    expect(spans[0]?.isFinal).toBe(true)
  })

  it('throws on a non-ok HTTP response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401))
    const provider = makeProvider(fetchMock)

    await expect(provider.transcribeBatch(pcm)).rejects.toThrow(/401/)
  })

  it('does not log the API key on failure', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const provider = makeProvider(vi.fn().mockResolvedValue(errorResponse(500)))

    await provider.transcribeBatch(pcm).catch(() => undefined)

    expect(logged.join('\n')).not.toContain('sk-test')
    errorSpy.mockRestore()
  })
})

describe('OpenAIBatchAsrProvider streaming methods (import-only)', () => {
  it('throws "not yet implemented" for the live streaming methods', () => {
    const provider = makeProvider(vi.fn())
    expect(() => provider.start()).toThrow(/not yet implemented/i)
    expect(() => provider.pushAudioFrame()).toThrow(/not yet implemented/i)
    expect(() => provider.spans()).toThrow(/not yet implemented/i)
  })
})
