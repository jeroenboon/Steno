import { describe, expect, it } from 'vitest'

import {
  PingRequestSchema,
  PingResponseSchema,
  MeetingEndRequestSchema,
  MeetingEndResponseSchema,
} from './ipc'

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

// Slice 2 — meeting:end schema (item 0021)

describe('MeetingEndRequestSchema', () => {
  it('parses a valid end-meeting request with a meetingId', () => {
    const result = MeetingEndRequestSchema.parse({ meetingId: 'mtg-123' })
    expect(result).toEqual({ meetingId: 'mtg-123' })
  })

  it('rejects when meetingId is empty', () => {
    expect(() => MeetingEndRequestSchema.parse({ meetingId: '' })).toThrow()
  })

  it('rejects when meetingId is missing', () => {
    expect(() => MeetingEndRequestSchema.parse({})).toThrow()
  })
})

describe('MeetingEndResponseSchema', () => {
  it('parses a valid end-meeting response', () => {
    const result = MeetingEndResponseSchema.parse({ ok: true })
    expect(result).toEqual({ ok: true })
  })

  it('rejects when ok is false', () => {
    expect(() => MeetingEndResponseSchema.parse({ ok: false })).toThrow()
  })
})
