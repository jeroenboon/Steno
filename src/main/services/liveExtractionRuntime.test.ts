/**
 * @vitest-environment node
 *
 * Tests for LiveExtractionRuntime (item 0018 — main-process half).
 *
 * This service is the orchestration layer that:
 *   - Filters interim spans out (isFinal === false must NOT be persisted or fed to extraction)
 *   - Persists final spans via transcriptSpanRepo (autosave, principle #13)
 *   - Feeds final spans into ExtractionLoopScheduler
 *   - Emits 'items:changed' IPC events when items are proposed
 *   - Degrades gracefully when no extraction provider is configured
 *   - Triggers scheduler.runFinalPass on meeting end and emits 'items:summaries'
 *   - Tears down cleanly (no leaked intervals)
 *
 * All tests are deterministic: FakeClock + FakeExtractionProvider + in-memory DB.
 * No real timers, no network. (Principle #11.)
 */

import Database from 'better-sqlite3'
import { describe, it, expect, afterEach, vi } from 'vitest'

import type { AgendaItem, Meeting, MeetingId, Participant, TranscriptSpan } from '@shared/domain'
import { FakeClock, FakeExtractionProvider } from '@shared/providers'

import { runMigrations } from '../db/migrate'
import { actionRepo } from '../db/repos/actionRepo'
import { decisionRepo } from '../db/repos/decisionRepo'
import { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import { meetingRepo } from '../db/repos/meetingRepo'
import { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'

import type { MeetingContext } from './extractionLoopScheduler'
import {
  LiveExtractionRuntime,
  type ItemsChangedPayload,
  type ItemsSummariesPayload,
} from './liveExtractionRuntime'

// ---------------------------------------------------------------------------
// Fake IPC sender — records all webContents.send() calls
// ---------------------------------------------------------------------------

interface RecordedSend {
  channel: string
  payload: unknown
}

class FakeIpcSender {
  readonly sent: RecordedSend[] = []

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }

  /** Return all payloads sent on a given channel, in order. */
  sentOn(channel: string): unknown[] {
    return this.sent.filter((s) => s.channel === channel).map((s) => s.payload)
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const MTG_ID: MeetingId = 'mtg-runtime-test'

const MEETING: Meeting = {
  id: MTG_ID,
  title: 'Q3 Sprint planning',
  state: 'live',
  source: 'live',
  paused: false,
  createdAt: '2026-06-18T09:00:00.000Z',
  primaryLanguage: 'nl',
}

const AGENDA: AgendaItem[] = [{ id: 'ai-1', title: 'Q3 review', topic: 'Review Q3 results' }]

const PARTICIPANTS: Participant[] = [{ id: 'p-1', name: 'Jeroen' }]

const CONTEXT: MeetingContext = {
  agendaItems: AGENDA,
  participants: PARTICIPANTS,
  primaryLanguage: 'nl',
}

function makeSpan(
  id: string,
  opts: { isFinal?: boolean; startMs?: number; endMs?: number } = {},
): TranscriptSpan {
  return {
    id,
    text: `Text for span ${id}`,
    startMs: opts.startMs ?? 0,
    endMs: opts.endMs ?? 1000,
    ...(opts.isFinal !== undefined ? { isFinal: opts.isFinal } : {}),
  }
}

interface Harness {
  db: Database.Database
  clock: FakeClock
  provider: FakeExtractionProvider
  sender: FakeIpcSender
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  dsRepo: ReturnType<typeof discussionSummaryRepo>
  runtime: LiveExtractionRuntime
}

/**
 * Build the full harness.
 *
 * When `noProvider` is true, `schedulerDeps` is null so the runtime operates
 * in the degraded path (persistence only, no extraction, no IPC item events).
 */
function buildHarness(opts: { noProvider?: boolean; cadenceMs?: number } = {}): Harness {
  const db = openDb()
  meetingRepo(db).insert(MEETING)

  const clock = new FakeClock(0)
  const provider = new FakeExtractionProvider()
  const dRepo = decisionRepo(db)
  const aRepo = actionRepo(db)
  const dsRepo = discussionSummaryRepo(db)
  const spanRepo = transcriptSpanRepo(db)
  const sender = new FakeIpcSender()

  const schedulerDeps = opts.noProvider
    ? null
    : {
        provider,
        discussionSummaryRepo: dsRepo,
        spanRepo,
        clock,
        cadenceMs: opts.cadenceMs ?? 20_000,
      }

  const runtime = new LiveExtractionRuntime({
    meetingId: MTG_ID,
    context: CONTEXT,
    schedulerDeps,
    decisionsRepo: dRepo,
    actionsRepo: aRepo,
    spanRepo,
    dsRepo,
    sender,
  })

  return { db, clock, provider, sender, spanRepo, dsRepo, runtime }
}

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 1. Interim span filtering
// ---------------------------------------------------------------------------

describe('interim span filtering', () => {
  it('does NOT persist an interim span (isFinal === false)', () => {
    const { spanRepo, runtime } = buildHarness()
    runtime.handleSpan(makeSpan('s-interim', { isFinal: false }))
    expect(spanRepo.listByMeeting(MTG_ID)).toHaveLength(0)
  })

  it('does NOT feed an interim span to the scheduler (provider not called)', async () => {
    const { clock, provider, runtime } = buildHarness()
    runtime.handleSpan(makeSpan('s-interim', { isFinal: false }))
    clock.tick(20_000)
    await runtime.tick()
    expect(provider.callCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Final span persistence + forwarding
// ---------------------------------------------------------------------------

describe('final span handling', () => {
  it('persists a span with isFinal: true', () => {
    const { spanRepo, runtime } = buildHarness()
    runtime.handleSpan(makeSpan('s-final', { isFinal: true }))
    expect(spanRepo.listByMeeting(MTG_ID)).toHaveLength(1)
  })

  it('persists a span with isFinal absent (treated as final per CONTEXT.md)', () => {
    const { spanRepo, runtime } = buildHarness()
    runtime.handleSpan(makeSpan('s-absent'))
    expect(spanRepo.listByMeeting(MTG_ID)).toHaveLength(1)
  })

  it('feeds a final span to the scheduler so the provider fires at cadence', async () => {
    const { clock, provider, runtime } = buildHarness()
    runtime.handleSpan(makeSpan('s-final', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()
    expect(provider.callCount()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. items:changed IPC event on item proposal
// ---------------------------------------------------------------------------

describe("'items:changed' IPC event", () => {
  it("emits 'items:changed' when the scheduler proposes a decision", async () => {
    const { clock, provider, sender, runtime } = buildHarness()

    provider.scriptRollingResponse({
      proposedDecisions: [{ rationale: 'Ship it', sourceSpanId: 's1', agendaItemHint: 'ai-1' }],
      proposedActions: [],
    })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()

    expect(sender.sentOn('items:changed')).toHaveLength(1)
  })

  it("'items:changed' payload carries the proposed decisions", async () => {
    const { clock, provider, sender, runtime } = buildHarness()

    provider.scriptRollingResponse({
      proposedDecisions: [{ rationale: 'Use Vitest', sourceSpanId: 's1' }],
      proposedActions: [],
    })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()

    const [event] = sender.sentOn('items:changed') as ItemsChangedPayload[]
    expect(event?.decisions).toHaveLength(1)
    expect(event?.actions).toHaveLength(0)
  })

  it("'items:changed' payload carries the proposed actions", async () => {
    const { clock, provider, sender, runtime } = buildHarness()

    provider.scriptRollingResponse({
      proposedDecisions: [],
      proposedActions: [{ description: 'Send the deck', sourceSpanId: 's1', ownerHint: 'Jeroen' }],
    })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()

    const [event] = sender.sentOn('items:changed') as ItemsChangedPayload[]
    expect(event?.actions).toHaveLength(1)
  })

  it("does NOT emit 'items:changed' if the provider returns no items", async () => {
    const { clock, sender, runtime } = buildHarness()
    // Default FakeExtractionProvider returns empty responses

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()

    expect(sender.sentOn('items:changed')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Degraded path: no extraction provider configured
// ---------------------------------------------------------------------------

describe('no extraction provider (degraded path)', () => {
  it('persists final spans even without a provider', () => {
    const { spanRepo, runtime } = buildHarness({ noProvider: true })
    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    expect(spanRepo.listByMeeting(MTG_ID)).toHaveLength(1)
  })

  it("does NOT emit 'items:changed' without a provider", async () => {
    const { clock, sender, runtime } = buildHarness({ noProvider: true })
    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()
    expect(sender.sentOn('items:changed')).toHaveLength(0)
  })

  it('does not crash when handleSpan is called without a provider', () => {
    const { runtime } = buildHarness({ noProvider: true })
    expect(() => {
      runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    }).not.toThrow()
  })

  it('does not crash when tick() is called without a provider', async () => {
    const { clock, runtime } = buildHarness({ noProvider: true })
    clock.tick(20_000)
    await expect(runtime.tick()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 5. Meeting end — final pass + items:summaries event
// ---------------------------------------------------------------------------

describe('meeting end', () => {
  it('calls runFinalPass exactly once when endMeeting is called', async () => {
    const { provider, runtime } = buildHarness()

    provider.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemId: 'ai-1', text: 'Q3 was solid.' }],
    })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    const endedMeeting: Meeting = { ...MEETING, state: 'ended' }
    await runtime.endMeeting(endedMeeting)

    // The scheduler's final pass uses isFinalPass=true
    expect(provider.calls().filter((c) => c.isFinalPass)).toHaveLength(1)
  })

  it("emits 'items:summaries' with discussion summaries after the final pass", async () => {
    const { provider, sender, runtime } = buildHarness()

    provider.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemId: 'ai-1', text: 'Q3 was solid.' }],
    })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    const endedMeeting: Meeting = { ...MEETING, state: 'ended' }
    await runtime.endMeeting(endedMeeting)

    const summaryEvents = sender.sentOn('items:summaries') as ItemsSummariesPayload[]
    expect(summaryEvents).toHaveLength(1)
    expect(summaryEvents[0]?.summaries).toHaveLength(1)
    expect(summaryEvents[0]?.summaries[0]?.text).toBe('Q3 was solid.')
  })

  it('calling endMeeting a second time does not trigger a second final pass', async () => {
    const { provider, runtime } = buildHarness()

    provider.scriptFinalPassResponse({ proposedDecisions: [], proposedActions: [] })

    const endedMeeting: Meeting = { ...MEETING, state: 'ended' }
    await runtime.endMeeting(endedMeeting)
    await runtime.endMeeting(endedMeeting)

    expect(provider.calls().filter((c) => c.isFinalPass)).toHaveLength(1)
  })

  it("emits 'items:changed' when the final pass proposes items", async () => {
    const { provider, sender, runtime } = buildHarness()

    provider.scriptFinalPassResponse({
      proposedDecisions: [{ rationale: 'Final decision', sourceSpanId: 's1' }],
      proposedActions: [],
      discussionSummaries: [],
    })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    const endedMeeting: Meeting = { ...MEETING, state: 'ended' }
    await runtime.endMeeting(endedMeeting)

    expect(sender.sentOn('items:changed')).toHaveLength(1)
  })

  it("emits 'items:summaries' even when no discussion summaries are produced", async () => {
    const { provider, sender, runtime } = buildHarness()

    provider.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [],
    })

    const endedMeeting: Meeting = { ...MEETING, state: 'ended' }
    await runtime.endMeeting(endedMeeting)

    const summaryEvents = sender.sentOn('items:summaries') as ItemsSummariesPayload[]
    expect(summaryEvents).toHaveLength(1)
    expect(summaryEvents[0]?.summaries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Running summary (item 0020)
// ---------------------------------------------------------------------------

describe('running summary', () => {
  it("emits 'summary:changed' after the cadence fires when spans exist", async () => {
    const { clock, provider, sender, runtime } = buildHarness()

    provider.scriptSummariseResponse('Vergadering gaat over Q3.')
    runtime.handleSpan(makeSpan('s1', { isFinal: true }))

    clock.tick(20_000)
    await runtime.tick()

    const summaryEvents = sender.sentOn('summary:changed') as { summary: string }[]
    expect(summaryEvents).toHaveLength(1)
    expect(summaryEvents[0]?.summary).toBe('Vergadering gaat over Q3.')
  })

  it("does NOT emit 'summary:changed' when no spans are present", async () => {
    const { clock, provider, sender, runtime } = buildHarness()

    provider.scriptSummariseResponse('Dit zou niet gestuurd moeten worden.')

    clock.tick(20_000)
    await runtime.tick()

    expect(sender.sentOn('summary:changed')).toHaveLength(0)
  })

  it('retains the last summary when summarise() throws (graceful degradation)', async () => {
    const { clock, provider, sender, runtime } = buildHarness()

    // First tick: succeeds, sets summary to 'Eerste samenvatting.'
    provider.scriptSummariseResponse('Eerste samenvatting.')
    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()

    expect(runtime.runningSummary).toBe('Eerste samenvatting.')

    // Second tick: provider.summarise throws
    vi.spyOn(provider, 'summarise').mockRejectedValueOnce(new Error('LLM fout'))
    clock.tick(20_000)
    await runtime.tick()

    // Summary retained; no new event emitted beyond the first
    expect(runtime.runningSummary).toBe('Eerste samenvatting.')
    expect(sender.sentOn('summary:changed')).toHaveLength(1)
  })

  it("does NOT emit 'summary:changed' in the degraded path (no provider)", async () => {
    const { clock, sender, runtime } = buildHarness({ noProvider: true })

    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    clock.tick(20_000)
    await runtime.tick()

    expect(sender.sentOn('summary:changed')).toHaveLength(0)
  })

  it('querySummary() returns the provider answer when spans exist', async () => {
    const { provider, runtime } = buildHarness()

    provider.scriptQueryResponse('Jeroen gaat de taak oppakken.')
    runtime.handleSpan(makeSpan('s1', { isFinal: true }))

    const answer = await runtime.querySummary('Wie pakt de taak op?')
    expect(answer).toBe('Jeroen gaat de taak oppakken.')
  })

  it('querySummary() returns empty string when no spans exist', async () => {
    const { runtime } = buildHarness()
    const answer = await runtime.querySummary('Wat werd besproken?')
    expect(answer).toBe('')
  })

  it('querySummary() returns empty string in the degraded path (no provider)', async () => {
    const { runtime } = buildHarness({ noProvider: true })
    const answer = await runtime.querySummary('Wat werd besproken?')
    expect(answer).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 7. Teardown — stop cleanly
// ---------------------------------------------------------------------------

describe('teardown', () => {
  it('stop() can be called without throwing', () => {
    const { runtime } = buildHarness()
    expect(() => {
      runtime.stop()
    }).not.toThrow()
  })

  it('after stop(), handleSpan does not persist spans', () => {
    const { spanRepo, runtime } = buildHarness()
    runtime.stop()
    runtime.handleSpan(makeSpan('s1', { isFinal: true }))
    expect(spanRepo.listByMeeting(MTG_ID)).toHaveLength(0)
  })

  it('after stop(), tick() is a no-op (no provider calls)', async () => {
    const { clock, provider, runtime } = buildHarness()
    runtime.stop()
    clock.tick(20_000)
    await runtime.tick()
    expect(provider.callCount()).toBe(0)
  })
})
