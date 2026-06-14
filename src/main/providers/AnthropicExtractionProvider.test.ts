/**
 * Tests for AnthropicExtractionProvider (item 0010).
 *
 * The Anthropic SDK is mocked entirely — no real network calls, no real key.
 * We test behaviour through the public ExtractionProvider interface only.
 *
 * Privacy principle #12: transcript content, prompts, and API keys must never
 * appear in logs. Spies on console.error and console.warn verify this.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExtractionRequest } from '@shared/providers'

import { AnthropicExtractionProvider } from './AnthropicExtractionProvider'

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const rollingRequest: ExtractionRequest = {
  spans: [{ id: 'span-1', text: 'We decided to launch in Q3.', startMs: 0, endMs: 3000 }],
  agendaItems: [{ id: 'agenda-1', title: 'Launch planning', topic: 'Planning the product launch' }],
  participants: [{ id: 'p-1', name: 'Jeroen' }],
  primaryLanguage: 'nl',
  isFinalPass: false,
}

const finalPassRequest: ExtractionRequest = {
  ...rollingRequest,
  isFinalPass: true,
}

/** Build a valid Anthropic tool-use response containing the given content. */
function makeToolUseResponse(content: Record<string, unknown>) {
  return {
    type: 'message',
    content: [
      {
        type: 'tool_use',
        id: 'tool-call-1',
        name: 'extract_meeting_notes',
        input: content,
      },
    ],
    stop_reason: 'tool_use',
  }
}

const validRollingContent = {
  proposedDecisions: [
    { rationale: 'Launch in Q3', sourceSpanId: 'span-1', agendaItemHint: 'Launch planning' },
  ],
  proposedActions: [{ description: 'Book venue', sourceSpanId: 'span-1', ownerHint: 'Jeroen' }],
}

const validFinalPassContent = {
  ...validRollingContent,
  discussionSummaries: [{ agendaItemId: 'agenda-1', text: 'Team discussed Q3 launch.' }],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider() {
  return new AnthropicExtractionProvider({ apiKey: 'test-key' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicExtractionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tracer bullet: happy path rolling extraction
  // -------------------------------------------------------------------------

  it('returns decisions and actions when the model returns valid JSON', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = makeProvider()
    const result = await provider.extract(rollingRequest)

    expect(result.proposedDecisions).toHaveLength(1)
    expect(result.proposedDecisions[0]?.rationale).toBe('Launch in Q3')
    expect(result.proposedActions).toHaveLength(1)
    expect(result.proposedActions[0]?.description).toBe('Book venue')
    expect(result.discussionSummaries).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Final pass: also returns discussion summaries
  // -------------------------------------------------------------------------

  it('includes discussionSummaries on the final pass', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validFinalPassContent))

    const provider = makeProvider()
    const result = await provider.extract(finalPassRequest)

    expect(result.discussionSummaries).toHaveLength(1)
    expect(result.discussionSummaries?.[0]?.agendaItemId).toBe('agenda-1')
  })

  // -------------------------------------------------------------------------
  // Model selection
  // -------------------------------------------------------------------------

  it('uses the rolling model (haiku) for non-final-pass requests', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = makeProvider()
    await provider.extract(rollingRequest)

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))
  })

  it('uses the final-pass model (sonnet) for isFinalPass=true requests', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validFinalPassContent))

    const provider = makeProvider()
    await provider.extract(finalPassRequest)

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }))
  })

  it('uses custom models when provided via constructor', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = new AnthropicExtractionProvider({
      apiKey: 'test-key',
      rollingModel: 'claude-haiku-4-5',
      finalPassModel: 'claude-opus-4-8',
    })
    await provider.extract(rollingRequest)

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))
  })

  // -------------------------------------------------------------------------
  // Prompt context: agenda, participants, language
  // -------------------------------------------------------------------------

  /** Helper: get the `system` prompt string from the first mockCreate call. */
  function captureSystemPrompt(): string {
    const arg: unknown = mockCreate.mock.calls[0]?.[0]
    if (typeof arg !== 'object' || arg === null || !('system' in arg)) return ''
    // After 'system' in arg, TS narrows arg to object & { system: unknown }
    const system: unknown = (arg as Record<string, unknown>).system
    return typeof system === 'string' ? system : ''
  }

  it('includes agenda item titles in the request to the model', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = makeProvider()
    await provider.extract(rollingRequest)

    expect(captureSystemPrompt()).toContain('Launch planning')
  })

  it('includes participant names in the request to the model', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = makeProvider()
    await provider.extract(rollingRequest)

    expect(captureSystemPrompt()).toContain('Jeroen')
  })

  it('includes the primary language in the request to the model', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = makeProvider()
    await provider.extract(rollingRequest)

    expect(captureSystemPrompt()).toContain('nl')
  })

  // -------------------------------------------------------------------------
  // Retry on validation failure → then empty response
  // -------------------------------------------------------------------------

  it('retries once when model returns invalid JSON, then returns empty response', async () => {
    const badResponse = makeToolUseResponse({ proposedDecisions: 'not-an-array' })
    mockCreate.mockResolvedValueOnce(badResponse).mockResolvedValueOnce(badResponse)

    const provider = makeProvider()
    const result = await provider.extract(rollingRequest)

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ proposedDecisions: [], proposedActions: [] })
  })

  it('returns empty response after one retry without throwing', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse({ proposedDecisions: 'bad' }))

    const provider = makeProvider()
    await expect(provider.extract(rollingRequest)).resolves.toEqual({
      proposedDecisions: [],
      proposedActions: [],
    })
  })

  // -------------------------------------------------------------------------
  // Principle #12: no transcript content or key in logs
  // -------------------------------------------------------------------------

  it('does not log transcript content when validation fails', async () => {
    const logged: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    mockCreate.mockResolvedValue(makeToolUseResponse({ proposedDecisions: 'bad' }))

    const provider = makeProvider()
    await provider.extract(rollingRequest)

    const allLogs = logged.join('\n')

    expect(allLogs).not.toContain('We decided to launch in Q3.')
    expect(allLogs).not.toContain('test-key')

    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Uses forced tool use (tool_choice)
  // -------------------------------------------------------------------------

  it('forces the model to use the extract_meeting_notes tool', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validRollingContent))

    const provider = makeProvider()
    await provider.extract(rollingRequest)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'extract_meeting_notes' },
      }),
    )
  })
})
