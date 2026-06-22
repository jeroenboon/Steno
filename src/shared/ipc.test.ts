import { describe, expect, it } from 'vitest'

import {
  PingRequestSchema,
  PingResponseSchema,
  MeetingEndRequestSchema,
  MeetingEndResponseSchema,
  ImportStartRequestSchema,
  ImportStartResponseSchema,
  ImportFinishRequestSchema,
  ImportProgressEventSchema,
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

// Slice 3 — import channels (item 0026)

describe('ImportStartRequestSchema', () => {
  const valid = {
    title: 'Geïmporteerde opname',
    primaryLanguage: 'nl',
    agendaItems: [{ title: 'Planning', topic: 'Q3' }],
    participants: [{ name: 'Jeroen' }],
    inferContext: false,
  }

  it('parses a valid import-start request', () => {
    expect(ImportStartRequestSchema.parse(valid)).toEqual(valid)
  })

  it('allows empty agenda + participants (inference path)', () => {
    const result = ImportStartRequestSchema.parse({
      ...valid,
      agendaItems: [],
      participants: [],
      inferContext: true,
    })
    expect(result.inferContext).toBe(true)
  })

  it('rejects an empty title', () => {
    expect(() => ImportStartRequestSchema.parse({ ...valid, title: '' })).toThrow()
  })

  it('rejects an agenda item with an empty topic', () => {
    expect(() =>
      ImportStartRequestSchema.parse({ ...valid, agendaItems: [{ title: 'x', topic: '' }] }),
    ).toThrow()
  })

  it('rejects a missing inferContext flag', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inferContext: _drop, ...rest } = valid
    expect(() => ImportStartRequestSchema.parse(rest)).toThrow()
  })
})

describe('ImportStartResponseSchema', () => {
  it('parses a response carrying the new meeting id', () => {
    expect(ImportStartResponseSchema.parse({ meetingId: 'imp-1' })).toEqual({ meetingId: 'imp-1' })
  })

  it('rejects an empty meeting id', () => {
    expect(() => ImportStartResponseSchema.parse({ meetingId: '' })).toThrow()
  })
})

describe('ImportFinishRequestSchema', () => {
  it('parses a valid finish request', () => {
    expect(ImportFinishRequestSchema.parse({ meetingId: 'imp-1' })).toEqual({ meetingId: 'imp-1' })
  })

  it('rejects a missing meeting id', () => {
    expect(() => ImportFinishRequestSchema.parse({})).toThrow()
  })
})

describe('ImportProgressEventSchema', () => {
  it('parses each known stage', () => {
    for (const stage of ['transcribing', 'inferring', 'extracting', 'done', 'error'] as const) {
      expect(ImportProgressEventSchema.parse({ stage }).stage).toBe(stage)
    }
  })

  it('allows an optional percent and error', () => {
    const result = ImportProgressEventSchema.parse({ stage: 'error', error: 'no key', percent: 50 })
    expect(result.error).toBe('no key')
    expect(result.percent).toBe(50)
  })

  it('rejects an unknown stage', () => {
    expect(() => ImportProgressEventSchema.parse({ stage: 'pondering' })).toThrow()
  })
})
