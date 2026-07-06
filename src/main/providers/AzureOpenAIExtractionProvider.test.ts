/**
 * Tests for AzureOpenAIExtractionProvider (Phase 2.1).
 *
 * fetch is injected, so no real network. Azure OpenAI speaks the same
 * chat-completions wire as OpenAI, so the parsing/retry behaviour mirrors
 * OpenAICompatibleExtractionProvider. What is Azure-specific and tested here:
 *   - the deployment URL shape `{endpoint}/openai/deployments/{deployment}/
 *     chat/completions?api-version=…`
 *   - the `api-key` header (not `Authorization: Bearer`)
 * Plus the shared contract: valid response parsed, one-retry-then-empty, the
 * final pass, and no logging of the key or transcript content.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import type { ExtractionRequest } from '@shared/providers'
import { captureConsole } from '@shared/testing/captureConsole'

import { AzureOpenAIExtractionProvider } from './AzureOpenAIExtractionProvider'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spans: TranscriptSpan[] = [
  { id: 'span-1', text: 'Jeroen opent de vergadering over de begroting.', startMs: 0, endMs: 4000 },
]

const extractionRequest: ExtractionRequest = {
  spans: [
    { id: 'span-1', text: 'We besluiten de begroting goed te keuren.', startMs: 0, endMs: 4000 },
  ],
  agendaItems: [{ id: 'agenda-1', title: 'Begroting', topic: 'Q3-begroting', state: 'confirmed' }],
  participants: [{ id: 'p-1', name: 'Jeroen' }],
  primaryLanguage: 'nl',
  isFinalPass: false,
}

const validExtraction = {
  proposedDecisions: [{ rationale: 'Begroting goedgekeurd', sourceSpanId: 'span-1' }],
  proposedActions: [
    { description: 'Begroting publiceren', sourceSpanId: 'span-1', ownerHint: 'Jeroen' },
  ],
}

const validInferred = {
  agendaItems: [{ title: 'Begroting', topic: 'Bespreken van de Q3-begroting' }],
  participants: [{ name: 'Jeroen' }],
}

/** Build a fake Azure OpenAI chat-completion fetch Response carrying `content`. */
function okResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

/** Build a fake HTTP-error fetch Response. */
function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response
}

function makeProvider(
  fetchImpl: typeof globalThis.fetch,
  overrides: Partial<{ endpoint: string; deployment: string; apiVersion: string }> = {},
) {
  return new AzureOpenAIExtractionProvider({
    apiKey: 'test-key',
    endpoint: overrides.endpoint ?? 'https://my-resource.openai.azure.com/',
    deployment: overrides.deployment ?? 'my-deployment',
    apiVersion: overrides.apiVersion ?? '2024-12-01-preview',
    model: 'gpt-4o-mini',
    displayName: 'Azure',
    fetch: fetchImpl,
  })
}

// ---------------------------------------------------------------------------
// extract()
// ---------------------------------------------------------------------------

describe('AzureOpenAIExtractionProvider.extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses an Azure chat-completion response into proposals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock)

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(result.proposedActions[0]?.description).toBe('Begroting publiceren')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('targets the Azure deployment URL with the api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock)

    await provider.extract(extractionRequest)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://my-resource.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-12-01-preview',
    )
    const headers = init.headers as Record<string, string>
    expect(headers['api-key']).toBe('test-key')
    expect(headers).not.toHaveProperty('Authorization')
  })

  it('retries once on invalid JSON, then degrades to empty proposals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('not json'))
    const provider = makeProvider(fetchMock)
    const console_ = captureConsole()

    const result = await provider.extract(extractionRequest)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ proposedDecisions: [], proposedActions: [] })
    console_.expectLogged(
      '[Azure] Validation failed, retrying',
      '[Azure] Retry failed, skipping turn',
    )
    console_.restore()
  })

  it('repairs via the one retry: invalid first, valid second', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse('broken {'))
      .mockResolvedValueOnce(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock)
    const console_ = captureConsole()

    const result = await provider.extract(extractionRequest)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    console_.expectLogged('[Azure] Validation failed, retrying')
    console_.restore()
  })

  it('asks for discussion summaries on the final pass', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        JSON.stringify({
          ...validExtraction,
          discussionSummaries: [{ agendaItemHint: 'agenda-1', text: 'Samenvatting' }],
        }),
      ),
    )
    const provider = makeProvider(fetchMock)

    const result = await provider.extract({ ...extractionRequest, isFinalPass: true })

    expect(result.discussionSummaries?.[0]?.text).toBe('Samenvatting')
    const body = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string
    expect(body).toContain('discussionSummaries')
  })

  it('does not log transcript content or the key when extraction fails', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const provider = makeProvider(vi.fn().mockResolvedValue(errorResponse(500)))

    await provider.extract(extractionRequest)

    const allLogs = logged.join('\n')
    expect(allLogs).toContain('[Azure]')
    expect(allLogs).not.toContain('begroting')
    expect(allLogs).not.toContain('test-key')

    errorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// inferContext()
// ---------------------------------------------------------------------------

describe('AzureOpenAIExtractionProvider.inferContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns inferred agenda items and participants from the transcript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validInferred)))
    const provider = makeProvider(fetchMock)

    const result = await provider.inferContext({ source: { spans } })

    expect(result.agendaItems[0]?.title).toBe('Begroting')
    expect(result.participants[0]?.name).toBe('Jeroen')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('infers from a text source and returns a title', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse(JSON.stringify({ ...validInferred, title: 'Begrotingsoverleg' })),
      )
    const provider = makeProvider(fetchMock)

    const result = await provider.inferContext({
      source: { text: 'Agenda: de Q3-begroting bespreken' },
    })

    expect(result.title).toBe('Begrotingsoverleg')
    expect(result.agendaItems[0]?.title).toBe('Begroting')
  })

  it('passes known agenda items as grounding and excludes topics already covered', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        JSON.stringify({
          agendaItems: [
            { title: 'Begroting', topic: 'Q3-begroting' },
            { title: 'Planning', topic: 'Nieuw onderwerp' },
          ],
          participants: [],
        }),
      ),
    )
    const provider = makeProvider(fetchMock)

    const result = await provider.inferContext({
      source: { spans },
      knownAgendaItems: [{ title: 'Begroting', topic: 'Reeds geagendeerd' }],
    })

    const serialised = JSON.stringify(fetchMock.mock.calls[0])
    expect(serialised).toContain('Reeds geagendeerd')
    expect(result.agendaItems.map((a) => a.title)).toEqual(['Planning'])
  })

  it('retries once on invalid JSON, then degrades to an empty context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify({ agendaItems: 'bad' })))
    const provider = makeProvider(fetchMock)
    const console_ = captureConsole()

    const result = await provider.inferContext({ source: { spans } })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ agendaItems: [], participants: [] })
    console_.expectLogged(
      '[Azure] Context inference failed, retrying',
      '[Azure] Context inference retry failed, returning empty',
    )
    console_.restore()
  })
})
