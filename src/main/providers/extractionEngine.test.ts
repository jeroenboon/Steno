/**
 * Tests for the vendor-neutral ExtractionEngine (arch review item 3, commit 1).
 *
 * The engine owns the extraction contract — prompt building, per-item Zod
 * coercion, the one-retry-then-degrade strategy, devlog, and the inferContext
 * flow — independent of transport. It talks to an ExtractionWire seam that
 * returns a parsed candidate object (or null on failure), so these tests drive
 * the engine through a fake wire: no network, no SDK, no fetch.
 *
 * Transport-specific behaviour (fence parsing, prompt_cache_key, URL/headers,
 * json_object) lives in the wires and is tested via the adapter suites.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import type { ExtractionRequest } from '@shared/providers'

import { initDevlog, resetDevlog } from '../devlog'

import { ExtractionEngine, type ExtractionCall, type ExtractionWire } from './extractionEngine'

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

/**
 * A fake ExtractionWire that returns queued candidate objects, one per call, and
 * records the calls. `null` in the queue simulates a transport/parse failure.
 */
function fakeWire(candidates: unknown[]): ExtractionWire & {
  calls: { call: ExtractionCall; system: string; user: string }[]
} {
  const calls: { call: ExtractionCall; system: string; user: string }[] = []
  let i = 0
  return {
    calls,
    extractInstruction: 'FAKE_EXTRACT_INSTRUCTION',
    inferInstruction: 'FAKE_INFER_INSTRUCTION',
    callStructured(call, system, user) {
      calls.push({ call, system, user })
      const value = i < candidates.length ? candidates[i] : null
      i += 1
      return Promise.resolve(value ?? null)
    },
  }
}

function makeEngine(wire: ExtractionWire): ExtractionEngine {
  return new ExtractionEngine({ wire, logTag: '[Fake]', model: 'fake-model' })
}

afterEach(() => {
  resetDevlog()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// extract()
// ---------------------------------------------------------------------------

describe('ExtractionEngine.extract', () => {
  it('coerces a valid candidate from the wire into proposals', async () => {
    const wire = fakeWire([validExtraction])
    const engine = makeEngine(wire)

    const result = await engine.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(result.proposedActions[0]?.description).toBe('Begroting publiceren')
    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0]?.call).toEqual({ kind: 'extract', isFinalPass: false })
  })

  it('appends the wire output-mechanism instruction to the shared prompt body', async () => {
    const wire = fakeWire([validExtraction])
    const engine = makeEngine(wire)

    await engine.extract(extractionRequest)

    const system = wire.calls[0]?.system ?? ''
    // The shared body carries the primary-language instruction (the "flavour"
    // both vendors now share); the per-vendor mechanism sentence is appended.
    expect(system).toContain('primaire taal van de vergadering')
    expect(system).toContain('FAKE_EXTRACT_INSTRUCTION')
  })

  it('retries once when the wire fails, then degrades to empty proposals', async () => {
    const wire = fakeWire([null, null])
    const engine = makeEngine(wire)

    const result = await engine.extract(extractionRequest)

    expect(result).toEqual({ proposedDecisions: [], proposedActions: [] })
    expect(wire.calls).toHaveLength(2)
  })

  it('repairs via the one retry: wire fails first, succeeds second', async () => {
    const wire = fakeWire([null, validExtraction])
    const engine = makeEngine(wire)

    const result = await engine.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(wire.calls).toHaveLength(2)
  })

  it('drops only the malformed item, keeping the rest of the turn (no retry)', async () => {
    const mixed = {
      // Invalid: empty sourceSpanId (min 1).
      proposedDecisions: [{ rationale: 'Ongeldig besluit', sourceSpanId: '' }],
      proposedActions: [{ description: 'Begroting publiceren', sourceSpanId: 'span-1' }],
    }
    const wire = fakeWire([mixed])
    const engine = makeEngine(wire)

    const result = await engine.extract(extractionRequest)

    expect(result.proposedDecisions).toEqual([])
    expect(result.proposedActions[0]?.description).toBe('Begroting publiceren')
    // A top-level object with a bad item is coerced, not retried.
    expect(wire.calls).toHaveLength(1)
  })

  it('retries when the candidate is not a JSON object at all', async () => {
    const wire = fakeWire(['a string, not an object', validExtraction])
    const engine = makeEngine(wire)

    const result = await engine.extract(extractionRequest)

    expect(result.proposedDecisions[0]?.rationale).toBe('Begroting goedgekeurd')
    expect(wire.calls).toHaveLength(2)
  })

  it('carries isFinalPass to the wire and keeps discussion summaries on the final pass', async () => {
    const withSummaries = {
      ...validExtraction,
      discussionSummaries: [{ agendaItemId: 'agenda-1', text: 'Samenvatting' }],
    }
    const wire = fakeWire([withSummaries])
    const engine = makeEngine(wire)

    const result = await engine.extract({ ...extractionRequest, isFinalPass: true })

    expect(result.discussionSummaries?.[0]?.text).toBe('Samenvatting')
    expect(wire.calls[0]?.call).toEqual({ kind: 'extract', isFinalPass: true })
    // The final-pass prompt asks for discussionSummaries.
    expect(wire.calls[0]?.system).toContain('discussionSummaries')
  })
})

// ---------------------------------------------------------------------------
// inferContext()
// ---------------------------------------------------------------------------

describe('ExtractionEngine.inferContext', () => {
  const validInferred = {
    agendaItems: [{ title: 'Begroting', topic: 'Bespreken van de Q3-begroting' }],
    participants: [{ name: 'Jeroen' }],
  }

  it('validates a candidate into inferred agenda items and participants', async () => {
    const wire = fakeWire([validInferred])
    const engine = makeEngine(wire)

    const result = await engine.inferContext({ source: { spans } })

    expect(result.agendaItems[0]?.title).toBe('Begroting')
    expect(result.participants[0]?.name).toBe('Jeroen')
    expect(wire.calls[0]?.call).toEqual({ kind: 'infer' })
  })

  it('grounds on known agenda items and excludes already-covered topics', async () => {
    const wire = fakeWire([
      {
        agendaItems: [
          { title: 'Begroting', topic: 'Q3-begroting' },
          { title: 'Planning', topic: 'Nieuw onderwerp' },
        ],
        participants: [],
      },
    ])
    const engine = makeEngine(wire)

    const result = await engine.inferContext({
      source: { spans },
      knownAgendaItems: [{ title: 'Begroting', topic: 'Reeds geagendeerd' }],
    })

    expect(wire.calls[0]?.system).toContain('Reeds geagendeerd')
    expect(wire.calls[0]?.system).toContain('FAKE_INFER_INSTRUCTION')
    expect(result.agendaItems.map((a) => a.title)).toEqual(['Planning'])
  })

  it('short-circuits empty sources without calling the wire', async () => {
    const wire = fakeWire([])
    const engine = makeEngine(wire)

    const result = await engine.inferContext({ source: { text: '   ' } })

    expect(result).toEqual({ agendaItems: [], participants: [] })
    expect(wire.calls).toHaveLength(0)
  })

  it('retries once on an invalid candidate, then degrades to an empty context', async () => {
    const wire = fakeWire([{ agendaItems: 'bad' }, { agendaItems: 'bad' }])
    const engine = makeEngine(wire)

    const result = await engine.inferContext({ source: { spans } })

    expect(result).toEqual({ agendaItems: [], participants: [] })
    expect(wire.calls).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// devlog wiring
// ---------------------------------------------------------------------------

describe('ExtractionEngine — devlog', () => {
  interface Line {
    category: string
    event: string
    meta?: { decisions?: string; actions?: string; dropped?: string[] }
    content?: { request?: string; response?: string }
  }

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
    await makeEngine(fakeWire([dropped])).extract(extractionRequest)

    const turn = lines.find((l) => l.event === 'turn')
    expect(turn?.meta?.decisions).toBe('1/1')
    expect(turn?.meta?.actions).toBe('0/1')
    expect(turn?.meta?.dropped).toContain('action.sourceSpanId')
    expect(turn?.content).toBeUndefined()
  })

  it('records the request and the re-serialised response in content mode', async () => {
    const lines = startDevlog(true)
    await makeEngine(fakeWire([validExtraction])).extract(extractionRequest)

    const turn = lines.find((l) => l.event === 'turn')
    expect(turn?.content?.request).toContain('begroting')
    expect(turn?.content?.response).toContain('Begroting goedgekeurd')
  })
})
