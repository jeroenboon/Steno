/**
 * @vitest-environment node
 *
 * Tests for LiveSessionController (architecture task 1).
 *
 * The controller owns the lifecycle of one live meeting session that previously
 * lived as closures and mutable vars inside `registerIpcHandlers` in index.ts:
 *   - start()        builds the ASR provider, the LiveExtractionRuntime and the
 *                    AudioCaptureBridge, then starts the bridge.
 *   - stop()         tears the bridge + runtime down.
 *   - endMeeting()   runs the final extraction pass on the active runtime.
 *   - querySummary() forwards a question to the active runtime.
 *   - pushAudioFrame forwards PCM frames to the active bridge.
 *
 * No Electron: a fake IpcSender, injected build functions returning fakes, and
 * an in-memory DB make every path deterministic (principle #11).
 */

import Database from 'better-sqlite3'
import { describe, it, expect, vi } from 'vitest'

import { FakeASRProvider, FakeClock, FakeExtractionProvider } from '@shared/providers'

import { runMigrations } from '../db/migrate'
import { actionRepo } from '../db/repos/actionRepo'
import { agendaItemRepo } from '../db/repos/agendaItemRepo'
import { decisionRepo } from '../db/repos/decisionRepo'
import { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import { meetingRepo } from '../db/repos/meetingRepo'
import { participantRepo } from '../db/repos/participantRepo'
import { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'
import { MemorySecretStorage } from '../settings/SecretStorage'
import { SettingsStore } from '../settings/SettingsStore'

import { LiveSessionController } from './LiveSessionController'

// ---------------------------------------------------------------------------
// Fakes / helpers
// ---------------------------------------------------------------------------

class FakeIpcSender {
  readonly sent: { channel: string; payload: unknown }[] = []

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }

  sentOn(channel: string): unknown[] {
    return this.sent.filter((s) => s.channel === channel).map((s) => s.payload)
  }
}

/** Flush the microtask + timer queue so the bridge span loop can run. */
async function flush(): Promise<void> {
  await new Promise<void>((r) => {
    setTimeout(r, 0)
  })
}

async function makeSettingsStore(): Promise<SettingsStore> {
  const store = new SettingsStore({
    userDataPath: '/fake',
    readFile: () => Promise.reject(new Error('no file')),
    writeFile: () => Promise.resolve(),
  })
  await store.load()
  return store
}

interface Harness {
  controller: LiveSessionController
  sender: FakeIpcSender
  asr: FakeASRProvider
  extraction: FakeExtractionProvider
  spanRepo: ReturnType<typeof transcriptSpanRepo>
  mRepo: ReturnType<typeof meetingRepo>
  buildAsr: ReturnType<typeof vi.fn>
}

async function buildHarness(opts: { asrOk?: boolean } = {}): Promise<Harness> {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)

  const settingsStore = await makeSettingsStore()
  const secretStorage = new MemorySecretStorage()
  const sender = new FakeIpcSender()
  const clock = new FakeClock(0)

  const asr = new FakeASRProvider()
  const extraction = new FakeExtractionProvider()

  const asrOk = opts.asrOk ?? true
  const buildAsr = vi.fn(() =>
    asrOk
      ? { ok: true as const, provider: asr }
      : { ok: false as const, error: 'Deepgram API key is not set' },
  )
  const buildExtraction = vi.fn(() => ({ ok: true as const, provider: extraction }))

  const spanRepo = transcriptSpanRepo(db)
  const mRepo = meetingRepo(db)

  const controller = new LiveSessionController({
    settingsStore,
    secretStorage,
    decisionRepo: decisionRepo(db),
    actionRepo: actionRepo(db),
    transcriptSpanRepo: spanRepo,
    discussionSummaryRepo: discussionSummaryRepo(db),
    meetingRepo: mRepo,
    agendaItemRepo: agendaItemRepo(db),
    participantRepo: participantRepo(db),
    sender,
    clock,
    buildAsr,
    buildExtraction,
  })

  return { controller, sender, asr, extraction, spanRepo, mRepo, buildAsr }
}

function makeSpan(id: string): import('@shared/domain').TranscriptSpan {
  return { id, text: `Text ${id}`, startMs: 0, endMs: 1000, isFinal: true }
}

// A real Meeting id (UUID-like), as the renderer threads through audio:start.
const MEETING_ID = 'mtg-real-9f1c'

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('start()', () => {
  it('builds a bridge and runtime, forwards frames to the ASR provider, and flows spans to the sender', async () => {
    const { controller, sender, asr } = await buildHarness()
    const pushSpy = vi.spyOn(asr, 'pushAudioFrame')

    controller.start(MEETING_ID)

    // A frame pushed after start() reaches the ASR provider.
    controller.pushAudioFrame(new Uint8Array([1, 2, 3]))
    expect(pushSpy).toHaveBeenCalledTimes(1)

    // A span emitted by the ASR provider flows out on 'transcript:span'.
    asr.pushScriptedSpan(makeSpan('s1'))
    await flush()

    const spans = sender.sentOn('transcript:span')
    expect(spans).toHaveLength(1)
  })

  it('builds a runtime scoped to the given meeting id; spans persist under it', async () => {
    const { controller, asr, spanRepo, mRepo } = await buildHarness()
    controller.start(MEETING_ID)

    asr.pushScriptedSpan(makeSpan('s1'))
    await flush()

    // The meeting row is upserted under the threaded id (not a placeholder).
    const meetings = mRepo.list()
    expect(meetings).toHaveLength(1)
    expect(meetings[0]?.id).toBe(MEETING_ID)

    // The span persists under that same row.
    expect(spanRepo.listByMeeting(MEETING_ID)).toHaveLength(1)
  })

  it('transitions an existing Draft meeting to Live via the enforcer (title preserved)', async () => {
    const { controller, mRepo } = await buildHarness()
    const now = new Date().toISOString()
    mRepo.insert({
      id: MEETING_ID,
      title: 'Kickoff',
      state: 'draft',
      source: 'live',
      paused: false,
      createdAt: now,
      primaryLanguage: 'nl',
      titleAutoGenerated: false,
    })

    controller.start(MEETING_ID)

    const meeting = mRepo.findById(MEETING_ID)
    expect(meeting?.state).toBe('live')
    expect(meeting?.startedAt).toBeTruthy()
    // The Draft title is preserved, not clobbered by the "Active Meeting" fallback.
    expect(meeting?.title).toBe('Kickoff')
  })

  it('clears a stale paused flag when resuming an interrupted (live) meeting', async () => {
    const { controller, mRepo } = await buildHarness()
    const now = new Date().toISOString()
    // An interrupted meeting: left in state 'live' with paused=true (the user
    // paused, then the app closed / crashed before ending it).
    mRepo.insert({
      id: MEETING_ID,
      title: 'Onderbroken',
      state: 'live',
      source: 'live',
      paused: true,
      createdAt: now,
      primaryLanguage: 'nl',
      startedAt: now,
      titleAutoGenerated: false,
    })

    controller.start(MEETING_ID)

    // Resuming records from the start, so the stale flag must be cleared —
    // otherwise the next meeting:pause throws "already paused".
    const meeting = mRepo.findById(MEETING_ID)
    expect(meeting?.state).toBe('live')
    expect(meeting?.paused).toBe(false)
  })

  it('called twice tears down the first bridge/runtime before building the second', async () => {
    const { controller, asr } = await buildHarness()
    const stopSpy = vi.spyOn(asr, 'stop')

    controller.start(MEETING_ID)
    controller.start(MEETING_ID)

    // The first session's ASR provider was stopped before the second start.
    expect(stopSpy).toHaveBeenCalled()
  })

  it('falls back to FakeASRProvider when the ASR key is missing (no throw)', async () => {
    const { controller, sender, asr } = await buildHarness({ asrOk: false })

    expect(() => {
      controller.start(MEETING_ID)
    }).not.toThrow()

    // The injected fake (asrOk:false) is NOT used; a frame is still accepted.
    expect(() => {
      controller.pushAudioFrame(new Uint8Array([1]))
    }).not.toThrow()

    // The scripted fake never receives anything because it wasn't wired in.
    asr.pushScriptedSpan(makeSpan('s1'))
    await flush()
    expect(sender.sentOn('transcript:span')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe('stop()', () => {
  it('tears down so a frame pushed after stop() is a no-op', async () => {
    const { controller, asr } = await buildHarness()
    controller.start(MEETING_ID)
    controller.stop()

    const pushSpy = vi.spyOn(asr, 'pushAudioFrame')
    controller.pushAudioFrame(new Uint8Array([1, 2, 3]))
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('is safe to call without a started session', async () => {
    const { controller } = await buildHarness()
    expect(() => {
      controller.stop()
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// endMeeting()
// ---------------------------------------------------------------------------

describe('endMeeting()', () => {
  it('runs the final pass on the row scoped to the threaded meeting id', async () => {
    const { controller, extraction, mRepo } = await buildHarness()
    extraction.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemHint: undefined, text: 'Klaar.' }],
    })

    controller.start(MEETING_ID)
    await controller.endMeeting(MEETING_ID)

    // The final pass ran exactly once, against the meeting started under MEETING_ID.
    expect(extraction.calls().filter((c) => c.isFinalPass)).toHaveLength(1)
    expect(mRepo.findById(MEETING_ID)).not.toBeNull()
  })

  it('transitions the meeting Live → Ended in the DB (state + endedAt)', async () => {
    const { controller, extraction, mRepo } = await buildHarness()
    extraction.scriptFinalPassResponse({ proposedDecisions: [], proposedActions: [] })

    controller.start(MEETING_ID)
    expect(mRepo.findById(MEETING_ID)?.state).toBe('live')

    await controller.endMeeting(MEETING_ID)

    const meeting = mRepo.findById(MEETING_ID)
    expect(meeting?.state).toBe('ended')
    expect(meeting?.endedAt).toBeTruthy()
  })

  it('does not run the final pass when the id does not match a known row', async () => {
    const { controller, extraction } = await buildHarness()
    extraction.scriptFinalPassResponse({ proposedDecisions: [], proposedActions: [] })

    controller.start(MEETING_ID)
    // A different id has no row → endMeeting finds nothing and the pass is skipped.
    await controller.endMeeting('mtg-other')

    expect(extraction.calls().filter((c) => c.isFinalPass)).toHaveLength(0)
  })

  it('is a safe no-op when no runtime is active', async () => {
    const { controller, extraction } = await buildHarness()
    await expect(controller.endMeeting(MEETING_ID)).resolves.toBeUndefined()
    expect(extraction.calls().filter((c) => c.isFinalPass)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// querySummary()
// ---------------------------------------------------------------------------

describe('querySummary()', () => {
  it('returns the empty string when no runtime is active', async () => {
    const { controller } = await buildHarness()
    await expect(controller.querySummary('Wat werd besproken?')).resolves.toBe('')
  })

  it('forwards the question to the active runtime', async () => {
    const { controller, extraction, asr } = await buildHarness()
    extraction.scriptQueryResponse('Jeroen pakt het op.')

    controller.start(MEETING_ID)
    asr.pushScriptedSpan(makeSpan('s1'))
    await flush()

    await expect(controller.querySummary('Wie pakt het op?')).resolves.toBe('Jeroen pakt het op.')
  })
})

// ---------------------------------------------------------------------------
// pause() / resume() — persist the paused flag AND halt/resume the runtime
// (review item 6b: this coordination moved out of the index.ts closures)
// ---------------------------------------------------------------------------

describe('pause() / resume()', () => {
  function seedLive(mRepo: ReturnType<typeof meetingRepo>): void {
    mRepo.insert({
      id: MEETING_ID,
      title: 'Live',
      state: 'live',
      source: 'live',
      paused: false,
      createdAt: '2026-07-04T10:00:00.000Z',
      startedAt: '2026-07-04T10:00:00.000Z',
      primaryLanguage: 'nl',
      titleAutoGenerated: false,
    })
  }

  it('pause() persists paused=true and returns the updated meeting', async () => {
    const { controller, mRepo } = await buildHarness()
    seedLive(mRepo)

    const meeting = controller.pause(MEETING_ID)

    expect(meeting.paused).toBe(true)
    expect(mRepo.findById(MEETING_ID)?.paused).toBe(true)
  })

  it('resume() persists paused=false and returns the updated meeting', async () => {
    const { controller, mRepo } = await buildHarness()
    seedLive(mRepo)
    controller.pause(MEETING_ID)

    const meeting = controller.resume(MEETING_ID)

    expect(meeting.paused).toBe(false)
    expect(mRepo.findById(MEETING_ID)?.paused).toBe(false)
  })

  it('pause() halts the active runtime cadence without crashing', async () => {
    const { controller, mRepo } = await buildHarness()
    seedLive(mRepo)
    controller.start(MEETING_ID)

    expect(() => controller.pause(MEETING_ID)).not.toThrow()
    expect(mRepo.findById(MEETING_ID)?.paused).toBe(true)
  })
})
