/**
 * Tests for the OpenAI-compatible extraction adapter (items 0012, 0026; Phase 1.3).
 *
 * fetch is injected, so no real network. We exercise the public
 * ExtractionProvider surface against the chat-completions response shapes used
 * by OpenAI and Mistral (both OpenAI-compatible, so the wire is identical and
 * one adapter serves the whole family):
 *   - extract(): valid response parsed; invalid JSON retried once then degraded;
 *     the JSON-repair path where the retry succeeds; the final pass.
 *   - inferContext(): same one-retry-then-empty strategy.
 *   - logs carry the vendor displayName and never the key or transcript content.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import type { ExtractionRequest } from '@shared/providers'
import { captureConsole } from '@shared/testing/captureConsole'

import { initDevlog, resetDevlog } from '../devlog'

import { OpenAICompatibleExtractionProvider } from './OpenAICompatibleExtractionProvider'

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

/** Build a fake OpenAI/Mistral chat-completion fetch Response carrying `content`. */
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
  overrides: Partial<{
    apiKey: string | undefined
    displayName: string
    baseUrl: string
    model: string
    sendCacheKey: boolean
    responseFormat: 'json_object' | 'text'
  }> = {},
) {
  // apiKey is omitted entirely when overridden to undefined (keyless local
  // server); default to a test key when not overridden at all.
  const apiKey = 'apiKey' in overrides ? overrides.apiKey : 'test-key'
  const opts = {
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    model: overrides.model ?? 'gpt-4o-mini',
    displayName: overrides.displayName ?? 'OpenAI',
    fetch: fetchImpl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(overrides.sendCacheKey === undefined ? {} : { sendCacheKey: overrides.sendCacheKey }),
    ...(overrides.responseFormat === undefined ? {} : { responseFormat: overrides.responseFormat }),
  }
  return new OpenAICompatibleExtractionProvider(opts)
}

/** Read the parsed request body of the Nth fetch call. */
function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[call]?.[1] as RequestInit).body as string) as Record<
    string,
    unknown
  >
}

/** Read the request headers of the Nth fetch call. */
function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>
}

// ---------------------------------------------------------------------------
// extract()
// ---------------------------------------------------------------------------

describe('OpenAICompatibleExtractionProvider.extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses an OpenAI chat-completion response into proposals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock, { displayName: 'OpenAI', model: 'gpt-4o-mini' })

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(result.proposedActions[0]?.description).toBe('Begroting publiceren')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('parses a Mistral chat-completion response into proposals (same wire)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock, {
      displayName: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-medium-3.5',
    })

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The endpoint is the vendor's base URL + /chat/completions.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mistral.ai/v1/chat/completions',
      expect.anything(),
    )
  })

  it('parses a fenced ```json code block (endpoint ignored json_object mode)', async () => {
    const fenced = '```json\n' + JSON.stringify(validExtraction) + '\n```'
    const fetchMock = vi.fn().mockResolvedValue(okResponse(fenced))
    const provider = makeProvider(fetchMock)

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(result.proposedActions[0]?.description).toBe('Begroting publiceren')
    // Recovered on the first call — no wasteful retry.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('parses a bare ``` fenced block with surrounding prose', async () => {
    const wrapped = `Hier is het resultaat:\n\`\`\`\n${JSON.stringify(validExtraction)}\n\`\`\`\nKlaar.`
    const fetchMock = vi.fn().mockResolvedValue(okResponse(wrapped))
    const provider = makeProvider(fetchMock)

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps decisions when the endpoint omits an empty proposedActions array', async () => {
    const partial = {
      proposedDecisions: [{ rationale: 'Begroting goedgekeurd', sourceSpanId: 'span-1' }],
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(partial)))
    const provider = makeProvider(fetchMock)

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(result.proposedActions).toEqual([])
    // A missing empty array is not a reason to retry or drop the turn.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops only the malformed item, keeping the rest of the turn', async () => {
    const mixed = {
      // Invalid: empty sourceSpanId (min 1).
      proposedDecisions: [{ rationale: 'Ongeldig besluit', sourceSpanId: '' }],
      // Valid.
      proposedActions: [{ description: 'Begroting publiceren', sourceSpanId: 'span-1' }],
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(mixed)))
    const provider = makeProvider(fetchMock)

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions).toEqual([])
    expect(result.proposedActions[0]?.description).toBe('Begroting publiceren')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on invalid JSON, then degrades to empty proposals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('not json'))
    const provider = makeProvider(fetchMock)
    const console_ = captureConsole()

    const result = await provider.extract(extractionRequest)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ proposedDecisions: [], proposedActions: [] })
    console_.expectLogged(
      '[OpenAI] Validation failed, retrying',
      '[OpenAI] Retry failed, skipping turn',
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
    console_.expectLogged('[OpenAI] Validation failed, retrying')
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

  it('sends a stable prompt_cache_key for the cacheable prefix across rolling ticks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock)

    await provider.extract(extractionRequest)
    await provider.extract(extractionRequest)

    const body1 = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>
    const body2 = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>

    expect(typeof body1.prompt_cache_key).toBe('string')
    expect((body1.prompt_cache_key as string).length).toBeGreaterThan(0)
    // Identical agenda/participants prefix → identical routing key → cache hit.
    expect(body2.prompt_cache_key).toBe(body1.prompt_cache_key)
  })

  it('omits prompt_cache_key when sendCacheKey is false (local endpoints)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock, { sendCacheKey: false })

    await provider.extract(extractionRequest)

    const body = requestBody(fetchMock)
    expect('prompt_cache_key' in body).toBe(false)
    // The rest of the body is unchanged: json_object mode still requested.
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('requests json_object response_format by default (cloud endpoints)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock)

    await provider.extract(extractionRequest)

    expect(requestBody(fetchMock).response_format).toEqual({ type: 'json_object' })
  })

  it('requests text response_format when responseFormat is text (local runtimes)', async () => {
    // Newer LM Studio rejects response_format.type "json_object" with HTTP 400
    // ("must be 'json_schema' or 'text'"). Local runtimes send `text` and lean on
    // the tolerant parseJsonLoose instead. See ADR 0040.
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock, { responseFormat: 'text' })

    const result = await provider.extract(extractionRequest)

    expect(requestBody(fetchMock).response_format).toEqual({ type: 'text' })
    // The response is still parsed into proposals via parseJsonLoose.
    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
  })

  it('fires onTerminal once and skips the retry on a truncated response', async () => {
    // finish_reason: length → the model was cut off mid-answer (ADR 0042).
    const truncated = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ choices: [{ finish_reason: 'length', message: { content: '' } }] }),
    } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValue(truncated)
    const provider = makeProvider(fetchMock)
    const onTerminal = vi.fn()
    provider.onTerminal(onTerminal)

    const result = await provider.extract(extractionRequest)

    expect(result).toEqual({ proposedDecisions: [], proposedActions: [] })
    expect(onTerminal).toHaveBeenCalledTimes(1)
    expect(onTerminal).toHaveBeenCalledWith({ reason: 'output-truncated' })
    // No retry — a truncation never improves on a second identical call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('omits the Authorization header when no apiKey is given (keyless local server)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock, { apiKey: undefined })

    const result = await provider.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect('Authorization' in requestHeaders(fetchMock)).toBe(false)
  })

  it('still sends the Authorization header when an apiKey is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction)))
    const provider = makeProvider(fetchMock, { apiKey: 'local-secret' })

    await provider.extract(extractionRequest)

    expect(requestHeaders(fetchMock).Authorization).toBe('Bearer local-secret')
  })

  it('tags error logs with the vendor displayName', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })

    await makeProvider(vi.fn().mockResolvedValue(errorResponse(500)), {
      displayName: 'OpenAI',
    }).extract(extractionRequest)
    await makeProvider(vi.fn().mockResolvedValue(errorResponse(500)), {
      displayName: 'Mistral',
    }).extract(extractionRequest)

    const allLogs = logged.join('\n')
    expect(allLogs).toContain('[OpenAI]')
    expect(allLogs).toContain('[Mistral]')

    errorSpy.mockRestore()
  })

  it('does not log transcript content or the key when extraction fails', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const provider = makeProvider(vi.fn().mockResolvedValue(okResponse('not json')))

    await provider.extract(extractionRequest)

    const allLogs = logged.join('\n')
    expect(allLogs).not.toContain('begroting')
    expect(allLogs).not.toContain('test-key')

    errorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// devlog wiring
// ---------------------------------------------------------------------------

describe('OpenAICompatibleExtractionProvider — devlog', () => {
  interface Line {
    category: string
    event: string
    meta?: { decisions?: string; actions?: string; dropped?: string[] }
    content?: { request?: string; response?: string }
  }

  afterEach(() => {
    resetDevlog()
  })

  function startDevlog(includeContent: boolean): Line[] {
    const lines: Line[] = []
    initDevlog({
      enabled: true,
      includeContent,
      write: (line) => lines.push(JSON.parse(line) as Line),
      now: () => 0,
    })
    return lines
  }

  it('logs a turn with kept/raw counts (metadata mode, no content)', async () => {
    const lines = startDevlog(false)
    const dropped = {
      proposedDecisions: [{ rationale: 'Geldig', sourceSpanId: 'span-1' }],
      proposedActions: [{ description: 'X', sourceSpanId: '' }], // invalid → dropped
    }
    await makeProvider(vi.fn().mockResolvedValue(okResponse(JSON.stringify(dropped)))).extract(
      extractionRequest,
    )

    const turn = lines.find((l) => l.event === 'turn')
    expect(turn?.meta?.decisions).toBe('1/1')
    expect(turn?.meta?.actions).toBe('0/1')
    expect(turn?.meta?.dropped).toContain('action.sourceSpanId')
    // Metadata mode: no content bucket, no transcript.
    expect(turn?.content).toBeUndefined()
  })

  it('records the LLM request and response in content mode', async () => {
    const lines = startDevlog(true)
    await makeProvider(
      vi.fn().mockResolvedValue(okResponse(JSON.stringify(validExtraction))),
    ).extract(extractionRequest)

    const turn = lines.find((l) => l.event === 'turn')
    // The request carries the transcript; the response carries the model output.
    expect(turn?.content?.request).toContain('begroting')
    expect(turn?.content?.response).toContain('Begroting goedgekeurd')
  })
})

// ---------------------------------------------------------------------------
// inferContext()
// ---------------------------------------------------------------------------

describe('OpenAICompatibleExtractionProvider.inferContext', () => {
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
      '[OpenAI] Context inference failed, retrying',
      '[OpenAI] Context inference retry failed, returning empty',
    )
    console_.restore()
  })

  it('does not log transcript content or the key when inference fails', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const fetchMock = vi.fn().mockResolvedValue(okResponse('not json'))
    const provider = makeProvider(fetchMock)

    await provider.inferContext({ source: { spans } })

    const allLogs = logged.join('\n')
    expect(allLogs).not.toContain('begroting')
    expect(allLogs).not.toContain('test-key')

    errorSpy.mockRestore()
  })
})
