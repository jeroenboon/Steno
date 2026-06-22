/**
 * Tests for CustomOpenAIExtractionProvider.inferContext (item 0026).
 *
 * fetch is injected, so no real network. We test the inferContext behaviour
 * through the public ExtractionProvider interface: valid JSON is parsed into an
 * InferredContext, an invalid response is retried once and then degrades to an
 * empty context, and neither transcript content nor the key is logged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'

import { CustomOpenAIExtractionProvider } from './CustomOpenAIExtractionProvider'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spans: TranscriptSpan[] = [
  { id: 'span-1', text: 'Jeroen opent de vergadering over de begroting.', startMs: 0, endMs: 4000 },
]

const validInferred = {
  agendaItems: [{ title: 'Begroting', topic: 'Bespreken van de Q3-begroting' }],
  participants: [{ name: 'Jeroen' }],
}

/** Build a fake OpenAI chat-completion fetch Response carrying `content`. */
function okResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

function makeProvider(fetchImpl: typeof globalThis.fetch) {
  return new CustomOpenAIExtractionProvider({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o',
    displayName: 'Example',
    fetch: fetchImpl,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomOpenAIExtractionProvider.inferContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns inferred agenda items and participants from the transcript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validInferred)))
    const provider = makeProvider(fetchMock)

    const result = await provider.inferContext(spans)

    expect(result.agendaItems[0]?.title).toBe('Begroting')
    expect(result.participants[0]?.name).toBe('Jeroen')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on invalid JSON, then degrades to an empty context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify({ agendaItems: 'bad' })))
    const provider = makeProvider(fetchMock)

    const result = await provider.inferContext(spans)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ agendaItems: [], participants: [] })
  })

  it('does not log transcript content or the key when inference fails', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const fetchMock = vi.fn().mockResolvedValue(okResponse('not json'))
    const provider = makeProvider(fetchMock)

    await provider.inferContext(spans)

    const allLogs = logged.join('\n')
    expect(allLogs).not.toContain('begroting')
    expect(allLogs).not.toContain('test-key')

    errorSpy.mockRestore()
  })
})
