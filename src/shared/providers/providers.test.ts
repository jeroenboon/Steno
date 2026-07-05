/**
 * Tests for item 0005 — Provider ports + fakes.
 *
 * Covers:
 *  - Clock abstraction (RealClock + FakeClock)
 *  - ASR boundary DTOs (Zod schemas round-trip)
 *  - Extraction boundary DTOs (Zod schemas round-trip)
 *  - FakeASRProvider behavioral contract
 *  - FakeExtractionProvider behavioral contract
 */

import { describe, expect, it } from 'vitest'

import { FakeClock, RealClock } from './clock'
import {
  ExtractionRequestSchema,
  ExtractionResponseSchema,
  InferredContextSchema,
  ProposedActionSchema,
  ProposedDecisionSchema,
} from './dtos'
import { FakeASRProvider } from './FakeASRProvider'
import { FakeExtractionProvider } from './FakeExtractionProvider'

// ============================================================================
// CLOCK
// ============================================================================

describe('RealClock', () => {
  it('returns a positive number', () => {
    const clock = new RealClock()
    expect(clock.now()).toBeGreaterThan(0)
  })

  it('returns non-decreasing values on successive calls', () => {
    const clock = new RealClock()
    const t1 = clock.now()
    const t2 = clock.now()
    expect(t2).toBeGreaterThanOrEqual(t1)
  })
})

describe('FakeClock', () => {
  it('starts at the configured time', () => {
    const clock = new FakeClock(1000)
    expect(clock.now()).toBe(1000)
  })

  it('defaults to zero when no start time is given', () => {
    const clock = new FakeClock()
    expect(clock.now()).toBe(0)
  })

  it('advances by the given delta when tick() is called', () => {
    const clock = new FakeClock(1000)
    clock.tick(500)
    expect(clock.now()).toBe(1500)
  })

  it('can be ticked multiple times cumulatively', () => {
    const clock = new FakeClock(0)
    clock.tick(100)
    clock.tick(200)
    expect(clock.now()).toBe(300)
  })

  it('can be set to an explicit time with setNow()', () => {
    const clock = new FakeClock(0)
    clock.tick(9999)
    clock.setNow(42)
    expect(clock.now()).toBe(42)
  })
})

// ============================================================================
// ASR DTO SCHEMAS
// ============================================================================

describe('ProposedDecisionSchema', () => {
  it('parses a valid proposed decision', () => {
    const result = ProposedDecisionSchema.parse({
      rationale: 'We agreed to use Zod for all boundary validation',
      sourceSpanId: 'span-1',
      agendaItemHint: 'agenda-1',
    })
    expect(result.rationale).toBe('We agreed to use Zod for all boundary validation')
    expect(result.sourceSpanId).toBe('span-1')
    expect(result.agendaItemHint).toBe('agenda-1')
  })

  it('allows agendaItemHint to be absent', () => {
    const result = ProposedDecisionSchema.parse({
      rationale: 'Ship it',
      sourceSpanId: 'span-2',
    })
    expect(result.agendaItemHint).toBeUndefined()
  })

  it('rejects a decision missing sourceSpanId', () => {
    expect(() =>
      ProposedDecisionSchema.parse({
        rationale: 'Ship it',
      }),
    ).toThrow()
  })
})

describe('ProposedActionSchema', () => {
  it('parses a valid proposed action', () => {
    const result = ProposedActionSchema.parse({
      description: 'Send the deck to the client',
      ownerHint: 'Jeroen',
      sourceSpanId: 'span-3',
      agendaItemHint: 'agenda-2',
    })
    expect(result.description).toBe('Send the deck to the client')
    expect(result.ownerHint).toBe('Jeroen')
  })

  it('allows ownerHint and agendaItemHint to be absent', () => {
    const result = ProposedActionSchema.parse({
      description: 'Follow up',
      sourceSpanId: 'span-4',
    })
    expect(result.ownerHint).toBeUndefined()
    expect(result.agendaItemHint).toBeUndefined()
  })

  it('rejects an action missing description', () => {
    expect(() =>
      ProposedActionSchema.parse({
        sourceSpanId: 'span-5',
      }),
    ).toThrow()
  })

  it('rejects an action missing sourceSpanId', () => {
    expect(() =>
      ProposedActionSchema.parse({
        description: 'Do the thing',
      }),
    ).toThrow()
  })
})

describe('ExtractionRequestSchema', () => {
  const validRequest = {
    spans: [
      {
        id: 'span-1',
        text: 'We decided to use Zod',
        startMs: 0,
        endMs: 2000,
        confidence: 0.95,
      },
    ],
    agendaItems: [
      {
        id: 'agenda-1',
        title: 'Architecture',
        topic: 'Pick the stack',
      },
    ],
    participants: [{ id: 'p-1', name: 'Jeroen' }],
    primaryLanguage: 'nl',
    isFinalPass: false,
  }

  it('parses a valid rolling-cadence extraction request', () => {
    const result = ExtractionRequestSchema.parse(validRequest)
    expect(result.isFinalPass).toBe(false)
    expect(result.spans).toHaveLength(1)
    expect(result.primaryLanguage).toBe('nl')
  })

  it('parses a valid final-pass extraction request', () => {
    const result = ExtractionRequestSchema.parse({ ...validRequest, isFinalPass: true })
    expect(result.isFinalPass).toBe(true)
  })

  it('allows spans to be empty (extraction might run before audio starts)', () => {
    const result = ExtractionRequestSchema.parse({ ...validRequest, spans: [] })
    expect(result.spans).toHaveLength(0)
  })

  it('rejects a request missing primaryLanguage', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { primaryLanguage: _pl, ...rest } = validRequest
    expect(() => ExtractionRequestSchema.parse(rest)).toThrow()
  })

  it('rejects a request missing isFinalPass', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isFinalPass: _fp, ...rest } = validRequest
    expect(() => ExtractionRequestSchema.parse(rest)).toThrow()
  })
})

describe('ExtractionResponseSchema', () => {
  it('parses a response with decisions and actions', () => {
    const result = ExtractionResponseSchema.parse({
      proposedDecisions: [{ rationale: 'Use TypeScript', sourceSpanId: 'span-1' }],
      proposedActions: [
        { description: 'Set up repo', sourceSpanId: 'span-2', ownerHint: 'Jeroen' },
      ],
    })
    expect(result.proposedDecisions).toHaveLength(1)
    expect(result.proposedActions).toHaveLength(1)
  })

  it('parses an empty response (provider found nothing)', () => {
    const result = ExtractionResponseSchema.parse({
      proposedDecisions: [],
      proposedActions: [],
    })
    expect(result.proposedDecisions).toHaveLength(0)
    expect(result.proposedActions).toHaveLength(0)
  })

  it('allows discussionSummaries to be present (final-pass only)', () => {
    const result = ExtractionResponseSchema.parse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemHint: 'agenda-1', text: 'We talked about the stack' }],
    })
    expect(result.discussionSummaries).toHaveLength(1)
    expect(result.discussionSummaries?.[0]?.text).toBe('We talked about the stack')
  })

  it('allows discussionSummaries to be absent (rolling pass)', () => {
    const result = ExtractionResponseSchema.parse({
      proposedDecisions: [],
      proposedActions: [],
    })
    expect(result.discussionSummaries).toBeUndefined()
  })

  it('rejects a response missing proposedDecisions', () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        proposedActions: [],
      }),
    ).toThrow()
  })
})

describe('InferredContextSchema', () => {
  it('parses inferred agenda items and participants', () => {
    const result = InferredContextSchema.parse({
      agendaItems: [{ title: 'Budget', topic: 'Q3 spend' }],
      participants: [{ name: 'Jeroen' }],
    })
    expect(result.agendaItems).toHaveLength(1)
    expect(result.agendaItems[0]?.title).toBe('Budget')
    expect(result.participants[0]?.name).toBe('Jeroen')
  })

  it('allows both lists to be empty (nothing could be inferred)', () => {
    const result = InferredContextSchema.parse({ agendaItems: [], participants: [] })
    expect(result.agendaItems).toEqual([])
    expect(result.participants).toEqual([])
  })

  it('rejects an agenda item with an empty title', () => {
    expect(() =>
      InferredContextSchema.parse({
        agendaItems: [{ title: '', topic: 'x' }],
        participants: [],
      }),
    ).toThrow()
  })

  it('rejects a participant with an empty name', () => {
    expect(() =>
      InferredContextSchema.parse({
        agendaItems: [],
        participants: [{ name: '' }],
      }),
    ).toThrow()
  })

  it('parses an optional inferred title', () => {
    const result = InferredContextSchema.parse({
      agendaItems: [],
      participants: [],
      title: 'Wekelijkse standup',
    })
    expect(result.title).toBe('Wekelijkse standup')
  })

  it('rejects an empty inferred title', () => {
    expect(() =>
      InferredContextSchema.parse({
        agendaItems: [],
        participants: [],
        title: '',
      }),
    ).toThrow()
  })
})

// ============================================================================
// FakeASRProvider
// ============================================================================

describe('FakeASRProvider', () => {
  it('has no pending spans before any are scripted', () => {
    const provider = new FakeASRProvider()
    provider.start()
    expect(provider.pendingCount()).toBe(0)
  })

  it('emits a scripted span when pushed', async () => {
    const provider = new FakeASRProvider()
    provider.start()

    const scriptedSpan = {
      id: 'span-1',
      text: 'Jeroen sends the deck',
      startMs: 0,
      endMs: 1500,
      confidence: 0.9,
    }
    provider.pushScriptedSpan(scriptedSpan)

    // Collect the one span
    const collected: unknown[] = []
    for await (const span of provider.spans()) {
      collected.push(span)
      if (collected.length === 1) break
    }

    expect(collected).toHaveLength(1)
    expect(collected[0]).toMatchObject({ text: 'Jeroen sends the deck' })
  })

  it('emits scripted spans in the order they were pushed', async () => {
    const provider = new FakeASRProvider()
    provider.start()

    provider.pushScriptedSpan({ id: 'span-a', text: 'First', startMs: 0, endMs: 500 })
    provider.pushScriptedSpan({ id: 'span-b', text: 'Second', startMs: 500, endMs: 1000 })
    provider.pushScriptedSpan({ id: 'span-c', text: 'Third', startMs: 1000, endMs: 1500 })

    const texts: string[] = []
    for await (const span of provider.spans()) {
      texts.push(span.text)
      if (texts.length === 3) break
    }

    expect(texts).toEqual(['First', 'Second', 'Third'])
  })

  it('stops emitting after stop() is called', async () => {
    const provider = new FakeASRProvider()
    provider.start()
    provider.pushScriptedSpan({ id: 'span-1', text: 'Hello', startMs: 0, endMs: 500 })
    provider.stop()

    const collected: unknown[] = []
    for await (const span of provider.spans()) {
      collected.push(span)
    }
    // After stop, the stream completes — we may or may not get the queued span
    // depending on timing, but the iterator must terminate (not block forever)
    expect(collected.length).toBeLessThanOrEqual(1)
  })

  it('accepts audio frames without throwing (structural contract)', () => {
    const provider = new FakeASRProvider()
    provider.start()
    expect(() => {
      provider.pushAudioFrame(new Uint8Array([0, 1, 2, 3]))
    }).not.toThrow()
  })

  it('transcribeBatch returns scripted spans and records the pcm it was given', async () => {
    const provider = new FakeASRProvider()
    provider.scriptBatchSpans([{ id: 's-1', text: 'Hallo wereld', startMs: 0, endMs: 1000 }])

    const pcm = new Uint8Array([1, 2, 3, 4])
    const spans = await provider.transcribeBatch(pcm)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('Hallo wereld')
    expect(provider.batchCalls()).toHaveLength(1)
    expect(provider.batchCalls()[0]).toBe(pcm)
  })

  it('transcribeBatch returns an empty array by default', async () => {
    const provider = new FakeASRProvider()
    expect(await provider.transcribeBatch(new Uint8Array(0))).toEqual([])
  })
})

// ============================================================================
// FakeExtractionProvider
// ============================================================================

describe('FakeExtractionProvider', () => {
  const minimalRequest = {
    spans: [],
    agendaItems: [],
    participants: [],
    primaryLanguage: 'nl',
    isFinalPass: false,
  }

  it('returns an empty response when no scripts are configured', async () => {
    const provider = new FakeExtractionProvider()
    const result = await provider.extract(minimalRequest)
    expect(result.proposedDecisions).toEqual([])
    expect(result.proposedActions).toEqual([])
    expect(result.discussionSummaries).toBeUndefined()
  })

  it('returns scripted items on a rolling call', async () => {
    const provider = new FakeExtractionProvider()
    provider.scriptRollingResponse({
      proposedDecisions: [{ rationale: 'Go with TypeScript', sourceSpanId: 'span-1' }],
      proposedActions: [],
    })

    const result = await provider.extract(minimalRequest)
    expect(result.proposedDecisions).toHaveLength(1)
    expect(result.proposedDecisions[0]?.rationale).toBe('Go with TypeScript')
  })

  it('returns scripted discussion summaries on a final-pass call', async () => {
    const provider = new FakeExtractionProvider()
    provider.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [{ description: 'Write docs', sourceSpanId: 'span-2' }],
      discussionSummaries: [{ agendaItemHint: 'agenda-1', text: 'We decided on the stack' }],
    })

    const result = await provider.extract({ ...minimalRequest, isFinalPass: true })
    expect(result.discussionSummaries).toHaveLength(1)
    expect(result.discussionSummaries?.[0]?.text).toBe('We decided on the stack')
    expect(result.proposedActions).toHaveLength(1)
  })

  it('does NOT return discussion summaries on a rolling call even if scripted', async () => {
    const provider = new FakeExtractionProvider()
    provider.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemHint: 'agenda-1', text: 'Irrelevant for rolling' }],
    })

    // Rolling call — should NOT return the final-pass script
    const result = await provider.extract({ ...minimalRequest, isFinalPass: false })
    expect(result.discussionSummaries).toBeUndefined()
  })

  it('uses rolling scripts in sequence, falling back to empty after exhaustion', async () => {
    const provider = new FakeExtractionProvider()
    provider.scriptRollingResponse({
      proposedDecisions: [{ rationale: 'First', sourceSpanId: 'span-1' }],
      proposedActions: [],
    })

    const first = await provider.extract(minimalRequest)
    const second = await provider.extract(minimalRequest) // no more scripts

    expect(first.proposedDecisions[0]?.rationale).toBe('First')
    expect(second.proposedDecisions).toEqual([])
  })

  it('records each call so tests can inspect call history', async () => {
    const provider = new FakeExtractionProvider()
    await provider.extract(minimalRequest)
    await provider.extract({ ...minimalRequest, isFinalPass: true })

    expect(provider.callCount()).toBe(2)
    expect(provider.calls()[0]?.isFinalPass).toBe(false)
    expect(provider.calls()[1]?.isFinalPass).toBe(true)
  })

  it('infers an empty context by default', async () => {
    const provider = new FakeExtractionProvider()
    const result = await provider.inferContext({ source: { spans: [] } })
    expect(result).toEqual({ agendaItems: [], participants: [] })
  })

  it('infers from a text source', async () => {
    const provider = new FakeExtractionProvider()
    provider.scriptInferContextResponse({
      agendaItems: [{ title: 'Roadmap', topic: 'Next quarter' }],
      participants: [],
      title: 'Productoverleg',
    })

    const result = await provider.inferContext({ source: { text: 'Agenda: roadmap bespreken' } })

    expect(result.title).toBe('Productoverleg')
    expect(result.agendaItems[0]?.title).toBe('Roadmap')
  })

  it('returns the scripted inferred context and records the input it was given', async () => {
    const provider = new FakeExtractionProvider()
    provider.scriptInferContextResponse({
      agendaItems: [{ title: 'Roadmap', topic: 'Next quarter' }],
      participants: [{ name: 'Anika' }],
    })

    const spans = [{ id: 'span-1', text: 'Anika opent de roadmap', startMs: 0, endMs: 1000 }]
    const result = await provider.inferContext({
      source: { spans },
      knownAgendaItems: [{ title: 'Roadmap', topic: 'Next quarter' }],
    })

    expect(result.agendaItems[0]?.title).toBe('Roadmap')
    expect(result.participants[0]?.name).toBe('Anika')
    expect(provider.inferContextCalls()).toHaveLength(1)
    const call = provider.inferContextCalls()[0]
    expect(call?.source).toEqual({ spans })
    expect(call?.knownAgendaItems?.[0]?.title).toBe('Roadmap')
  })
})
