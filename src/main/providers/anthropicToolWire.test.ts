/**
 * Wire-level tests for AnthropicToolWire's truncation detection (ADR 0042).
 *
 * The tool-use decode is covered through the provider surface in
 * AnthropicExtractionProvider.test.ts; this file pins the wire-only behaviour: a
 * `stop_reason: "max_tokens"` response throws ExtractionTruncatedError.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AnthropicToolWire } from './anthropicToolWire'
import { ExtractionTruncatedError } from './extractionEngine'

function makeWire(create: ReturnType<typeof vi.fn>): AnthropicToolWire {
  const client = { messages: { create } } as unknown as Anthropic
  return new AnthropicToolWire({
    client,
    rollingModel: 'haiku',
    finalPassModel: 'sonnet',
    logTag: '[Test]',
  })
}

describe('AnthropicToolWire truncation detection', () => {
  it('throws ExtractionTruncatedError on stop_reason "max_tokens"', async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: 'max_tokens', content: [] })
    const wire = makeWire(create)

    await expect(
      wire.callStructured({ kind: 'extract', isFinalPass: false }, 'sys', 'usr'),
    ).rejects.toBeInstanceOf(ExtractionTruncatedError)
  })

  it('does not throw on stop_reason "tool_use"', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', name: 'extract_meeting_notes', input: { proposedActions: [] } },
      ],
    })
    const wire = makeWire(create)

    await expect(
      wire.callStructured({ kind: 'extract', isFinalPass: false }, 'sys', 'usr'),
    ).resolves.toEqual({ proposedActions: [] })
  })
})
