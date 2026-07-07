/**
 * Wire-level tests for OpenAiJsonWire's truncation detection (ADR 0042).
 *
 * The parse/response-shape behaviour is covered through the provider surface in
 * OpenAICompatibleExtractionProvider.test.ts; this file pins the one thing that
 * lives purely in the wire: a `finish_reason: "length"` response throws
 * ExtractionTruncatedError (distinct from the null returned on other failures).
 */

import { describe, expect, it, vi } from 'vitest'

import { ExtractionTruncatedError } from './extractionEngine'
import { OpenAiJsonWire } from './openAiJsonWire'

function makeWire(fetchImpl: typeof globalThis.fetch): OpenAiJsonWire {
  return new OpenAiJsonWire({
    model: 'test-model',
    logTag: '[Test]',
    target: { url: 'http://localhost/v1/chat/completions', headers: {} },
    fetch: fetchImpl,
  })
}

function response(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

describe('OpenAiJsonWire truncation detection', () => {
  it('throws ExtractionTruncatedError on finish_reason "length"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ choices: [{ finish_reason: 'length', message: { content: '' } }] }),
      )
    const wire = makeWire(fetchMock)

    await expect(
      wire.callStructured({ kind: 'extract', isFinalPass: false }, 'sys', 'usr'),
    ).rejects.toBeInstanceOf(ExtractionTruncatedError)
  })

  it('does not throw on a normal finish_reason "stop"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        choices: [{ finish_reason: 'stop', message: { content: '{"proposedActions":[]}' } }],
      }),
    )
    const wire = makeWire(fetchMock)

    await expect(
      wire.callStructured({ kind: 'extract', isFinalPass: false }, 'sys', 'usr'),
    ).resolves.toEqual({ proposedActions: [] })
  })
})
