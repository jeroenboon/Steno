import { describe, expect, it } from 'vitest'

import { PingRequestSchema, PingResponseSchema } from './ipc'

// Slice 1 — Zod schema validation: valid payloads parse, invalid ones throw

describe('PingRequestSchema', () => {
  it('parses a valid empty-object ping request', () => {
    const result = PingRequestSchema.parse({})
    expect(result).toEqual({})
  })

  it('rejects a non-object payload', () => {
    expect(() => PingRequestSchema.parse('not-an-object')).toThrow()
  })
})

describe('PingResponseSchema', () => {
  it('parses a valid pong response', () => {
    const result = PingResponseSchema.parse({ pong: true })
    expect(result).toEqual({ pong: true })
  })

  it('rejects a response missing the pong field', () => {
    expect(() => PingResponseSchema.parse({})).toThrow()
  })

  it('rejects pong set to false', () => {
    expect(() => PingResponseSchema.parse({ pong: false })).toThrow()
  })
})
