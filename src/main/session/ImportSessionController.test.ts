/**
 * @vitest-environment node
 *
 * Tests for ImportSessionController (item 0026).
 *
 * The controller orchestrates an offline import: it runs file PCM frames through
 * the configured ASR provider, persists the spans, optionally infers the agenda +
 * participants, then runs the same final extraction pass as a live meeting and
 * marks the meeting Ended. Everything is injected (fake ASR, fake extraction,
 * in-memory DB, fake clock, fake sender) so the test is deterministic with no
 * real audio, network, or timers.
 */

import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeASRProvider, FakeClock, FakeExtractionProvider } from '@shared/providers'
import type { AppSettings } from '@shared/settings/settingsSchema'
import { captureConsole } from '@shared/testing/captureConsole'

import { runMigrations } from '../db/migrate'
import { actionRepo } from '../db/repos/actionRepo'
import { agendaItemRepo } from '../db/repos/agendaItemRepo'
import { decisionRepo } from '../db/repos/decisionRepo'
import { discussionSummaryRepo } from '../db/repos/discussionSummaryRepo'
import { meetingRepo } from '../db/repos/meetingRepo'
import { participantRepo } from '../db/repos/participantRepo'
import { transcriptSpanRepo } from '../db/repos/transcriptSpanRepo'
import type { SecretStorage } from '../settings/SecretStorage'
import type { SettingsStore } from '../settings/SettingsStore'

import { ImportSessionController } from './ImportSessionController'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SETTINGS: AppSettings = {
  asrProvider: 'deepgram',
  extractionProvider: 'anthropic',
  primaryLanguage: 'nl',
}

function makeRepos() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return {
    db,
    meetingRepo: meetingRepo(db),
    agendaItemRepo: agendaItemRepo(db),
    participantRepo: participantRepo(db),
    transcriptSpanRepo: transcriptSpanRepo(db),
    decisionRepo: decisionRepo(db),
    actionRepo: actionRepo(db),
    discussionSummaryRepo: discussionSummaryRepo(db),
  }
}

interface SentMessage {
  channel: string
  payload: unknown
}

function makeSender() {
  const sent: SentMessage[] = []
  return {
    sent,
    sender: {
      send(channel: string, ...args: unknown[]): void {
        sent.push({ channel, payload: args[0] })
      },
    },
    /** Progress stages emitted, in order. */
    stages(): string[] {
      return sent
        .filter((m) => m.channel === 'import:progress')
        .map((m) => (m.payload as { stage: string }).stage)
    },
  }
}

function makeController(
  repos: ReturnType<typeof makeRepos>,
  fakeAsr: FakeASRProvider,
  fakeExtraction: FakeExtractionProvider | null,
  sender: ReturnType<typeof makeSender>['sender'],
) {
  return new ImportSessionController({
    settingsStore: { current: SETTINGS } as unknown as SettingsStore,
    secretStorage: {} as unknown as SecretStorage,
    meetingRepo: repos.meetingRepo,
    agendaItemRepo: repos.agendaItemRepo,
    participantRepo: repos.participantRepo,
    transcriptSpanRepo: repos.transcriptSpanRepo,
    decisionRepo: repos.decisionRepo,
    actionRepo: repos.actionRepo,
    discussionSummaryRepo: repos.discussionSummaryRepo,
    sender,
    clock: new FakeClock(1000),
    buildAsr: () => ({ ok: true, provider: fakeAsr }),
    buildExtraction:
      fakeExtraction !== null
        ? () => ({ ok: true, provider: fakeExtraction })
        : () => ({ ok: false, error: 'no extraction key' }),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportSessionController', () => {
  let repos: ReturnType<typeof makeRepos>

  beforeEach(() => {
    repos = makeRepos()
  })

  it('transcribes an imported file and produces notes via the final pass', async () => {
    const fakeAsr = new FakeASRProvider()
    fakeAsr.scriptBatchSpans([{ id: 'span-1', text: 'We launchen in Q3', startMs: 0, endMs: 2000 }])
    const fakeExtraction = new FakeExtractionProvider()
    fakeExtraction.scriptFinalPassResponse({
      proposedDecisions: [{ rationale: 'We launchen in Q3', sourceSpanId: 'span-1' }],
      proposedActions: [],
      discussionSummaries: [{ agendaItemHint: undefined, text: 'Besproken: de planning.' }],
    })
    const s = makeSender()
    const controller = makeController(repos, fakeAsr, fakeExtraction, s.sender)

    controller.start({
      meetingId: 'imp-1',
      title: 'Geïmporteerde opname',
      primaryLanguage: 'nl',
      agendaItems: [{ title: 'Planning', topic: 'Q3' }],
      participants: [{ name: 'Jeroen' }],
      inferContext: false,
    })

    // Meeting persisted as a live import while transcribing.
    const live = repos.meetingRepo.findById('imp-1')
    expect(live?.state).toBe('live')
    expect(live?.source).toBe('import')
    // User-supplied agenda + participants persisted.
    expect(repos.agendaItemRepo.listByMeeting('imp-1')).toHaveLength(1)
    expect(repos.participantRepo.listByMeeting('imp-1')).toHaveLength(1)

    // Feed a decoded PCM frame, then finish (batch transcription runs here).
    controller.pushFrame(new Uint8Array([0, 0, 0, 0]))

    const result = await controller.finish('imp-1')

    expect(result).toEqual({ meetingId: 'imp-1' })
    // Span persisted.
    expect(repos.transcriptSpanRepo.listByMeeting('imp-1')).toHaveLength(1)
    // Final pass produced notes.
    expect(repos.discussionSummaryRepo.listByMeeting('imp-1').length).toBeGreaterThan(0)
    expect(repos.decisionRepo.listByMeeting('imp-1').length).toBeGreaterThan(0)
    // Meeting ended.
    expect(repos.meetingRepo.findById('imp-1')?.state).toBe('ended')
    // Progress stages.
    expect(s.stages()).toContain('transcribing')
    expect(s.stages()).toContain('extracting')
    expect(s.stages()[s.stages().length - 1]).toBe('done')
  })

  it('infers agenda + participants and feeds them to the final pass', async () => {
    const fakeAsr = new FakeASRProvider()
    fakeAsr.scriptBatchSpans([
      { id: 'span-1', text: 'Anika opent de begroting', startMs: 0, endMs: 2000 },
    ])
    const fakeExtraction = new FakeExtractionProvider()
    fakeExtraction.scriptInferContextResponse({
      agendaItems: [{ title: 'Begroting', topic: 'Q3-begroting' }],
      participants: [{ name: 'Anika' }],
    })
    fakeExtraction.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemHint: undefined, text: 'Besproken.' }],
    })
    const s = makeSender()
    const controller = makeController(repos, fakeAsr, fakeExtraction, s.sender)

    controller.start({
      meetingId: 'imp-infer',
      title: 'Opname zonder agenda',
      primaryLanguage: 'nl',
      agendaItems: [],
      participants: [],
      inferContext: true,
    })
    controller.pushFrame(new Uint8Array([0, 0, 0, 0]))

    await controller.finish('imp-infer')

    // Inferred context persisted.
    const agenda = repos.agendaItemRepo.listByMeeting('imp-infer')
    const participants = repos.participantRepo.listByMeeting('imp-infer')
    expect(agenda.map((a) => a.title)).toContain('Begroting')
    expect(participants.map((p) => p.name)).toContain('Anika')
    // Inferred agenda items are Proposed, not Confirmed (ADR 0029).
    expect(agenda.find((a) => a.title === 'Begroting')?.state).toBe('proposed')

    // The inferred context reached the final pass.
    const finalCall = fakeExtraction.calls().find((c) => c.isFinalPass)
    expect(finalCall?.agendaItems.map((a) => a.title)).toContain('Begroting')
    expect(finalCall?.participants.map((p) => p.name)).toContain('Anika')

    expect(s.stages()).toContain('inferring')
  })

  it('degrades and still ends the meeting when inferContext rejects (C2)', async () => {
    // A transient provider failure at the inference step must not strand the
    // import: the final pass must still run and the meeting must still end.
    const fakeAsr = new FakeASRProvider()
    fakeAsr.scriptBatchSpans([{ id: 'span-1', text: 'Anika opent', startMs: 0, endMs: 2000 }])
    const fakeExtraction = new FakeExtractionProvider()
    vi.spyOn(fakeExtraction, 'inferContext').mockRejectedValue(new Error('429 rate limit'))
    fakeExtraction.scriptFinalPassResponse({
      proposedDecisions: [],
      proposedActions: [],
      discussionSummaries: [{ agendaItemHint: undefined, text: 'Toch samengevat.' }],
    })
    const s = makeSender()
    const controller = makeController(repos, fakeAsr, fakeExtraction, s.sender)
    const console_ = captureConsole()

    controller.start({
      meetingId: 'imp-infer-fail',
      title: 'Opname zonder agenda',
      primaryLanguage: 'nl',
      agendaItems: [],
      participants: [],
      inferContext: true,
    })
    controller.pushFrame(new Uint8Array([0, 0, 0, 0]))

    const result = await controller.finish('imp-infer-fail')

    expect(result).toEqual({ meetingId: 'imp-infer-fail' })
    // The final pass still ran despite the inference failure.
    expect(repos.discussionSummaryRepo.listByMeeting('imp-infer-fail').length).toBeGreaterThan(0)
    // The meeting still transitioned to Ended.
    expect(repos.meetingRepo.findById('imp-infer-fail')?.state).toBe('ended')
    expect(s.stages()[s.stages().length - 1]).toBe('done')
    console_.expectLogged('[ImportSessionController] context inference failed')
    console_.restore()
  })

  it('uses the user-supplied context and does not infer when inferContext is false', async () => {
    const fakeAsr = new FakeASRProvider()
    fakeAsr.scriptBatchSpans([
      { id: 'span-1', text: 'Planning besproken', startMs: 0, endMs: 1000 },
    ])
    const fakeExtraction = new FakeExtractionProvider()
    fakeExtraction.scriptFinalPassResponse({ proposedDecisions: [], proposedActions: [] })
    const s = makeSender()
    const controller = makeController(repos, fakeAsr, fakeExtraction, s.sender)

    controller.start({
      meetingId: 'imp-supplied',
      title: 'Met agenda',
      primaryLanguage: 'nl',
      agendaItems: [{ title: 'Planning', topic: 'Q3' }],
      participants: [{ name: 'Jeroen' }],
      inferContext: false,
    })
    controller.pushFrame(new Uint8Array([0, 0, 0, 0]))

    await controller.finish('imp-supplied')

    expect(fakeExtraction.inferContextCalls()).toHaveLength(0)
    const finalCall = fakeExtraction.calls().find((c) => c.isFinalPass)
    expect(finalCall?.agendaItems.map((a) => a.title)).toEqual(['Planning'])
    expect(finalCall?.participants.map((p) => p.name)).toEqual(['Jeroen'])
    expect(s.stages()).not.toContain('inferring')
  })

  it('still ends the meeting with no notes when no extraction provider is configured', async () => {
    const fakeAsr = new FakeASRProvider()
    fakeAsr.scriptBatchSpans([{ id: 'span-1', text: 'Iets gezegd', startMs: 0, endMs: 1000 }])
    const s = makeSender()
    const controller = makeController(repos, fakeAsr, null, s.sender)
    const console_ = captureConsole()

    controller.start({
      meetingId: 'imp-degraded',
      title: 'Geen extractie-key',
      primaryLanguage: 'nl',
      agendaItems: [],
      participants: [],
      inferContext: true,
    })
    controller.pushFrame(new Uint8Array([0, 0, 0, 0]))

    const result = await controller.finish('imp-degraded')

    expect(result).toEqual({ meetingId: 'imp-degraded' })
    expect(repos.transcriptSpanRepo.listByMeeting('imp-degraded')).toHaveLength(1)
    expect(repos.discussionSummaryRepo.listByMeeting('imp-degraded')).toHaveLength(0)
    expect(repos.decisionRepo.listByMeeting('imp-degraded')).toHaveLength(0)
    expect(repos.meetingRepo.findById('imp-degraded')?.state).toBe('ended')
    expect(s.stages()[s.stages().length - 1]).toBe('done')
    console_.expectLogged('[ImportSessionController] No extraction provider configured')
    console_.restore()
  })

  it('emits an error and does not transcribe when the ASR provider is not configured', () => {
    const fakeAsr = new FakeASRProvider()
    const s = makeSender()
    const controller = new ImportSessionController({
      settingsStore: { current: SETTINGS } as unknown as SettingsStore,
      secretStorage: {} as unknown as SecretStorage,
      meetingRepo: repos.meetingRepo,
      agendaItemRepo: repos.agendaItemRepo,
      participantRepo: repos.participantRepo,
      transcriptSpanRepo: repos.transcriptSpanRepo,
      decisionRepo: repos.decisionRepo,
      actionRepo: repos.actionRepo,
      discussionSummaryRepo: repos.discussionSummaryRepo,
      sender: s.sender,
      clock: new FakeClock(1000),
      buildAsr: () => ({ ok: false, error: 'no asr key' }),
      buildExtraction: () => ({ ok: true, provider: new FakeExtractionProvider() }),
    })

    controller.start({
      meetingId: 'imp-noasr',
      title: 'Geen ASR-key',
      primaryLanguage: 'nl',
      agendaItems: [],
      participants: [],
      inferContext: false,
    })

    expect(s.stages()).toContain('error')
    expect(s.stages()).not.toContain('transcribing')
    // The meeting row still exists (as a live import) so the renderer can react.
    expect(repos.meetingRepo.findById('imp-noasr')?.source).toBe('import')
    void fakeAsr
  })

  it('emits an error and produces no notes when transcription fails', async () => {
    const fakeAsr = new FakeASRProvider()
    vi.spyOn(fakeAsr, 'transcribeBatch').mockRejectedValue(new Error('deepgram 401'))
    const fakeExtraction = new FakeExtractionProvider()
    const s = makeSender()
    const controller = makeController(repos, fakeAsr, fakeExtraction, s.sender)
    const console_ = captureConsole()

    controller.start({
      meetingId: 'imp-fail',
      title: 'Mislukte transcriptie',
      primaryLanguage: 'nl',
      agendaItems: [],
      participants: [],
      inferContext: false,
    })
    controller.pushFrame(new Uint8Array([0, 0, 0, 0]))

    const result = await controller.finish('imp-fail')

    expect(result).toEqual({ meetingId: 'imp-fail' })
    expect(s.stages()).toContain('error')
    expect(repos.transcriptSpanRepo.listByMeeting('imp-fail')).toHaveLength(0)
    expect(repos.discussionSummaryRepo.listByMeeting('imp-fail')).toHaveLength(0)
    // The final pass never ran, so the meeting was not marked ended.
    expect(repos.meetingRepo.findById('imp-fail')?.state).toBe('live')
    console_.expectLogged('[ImportSessionController] Transcription failed')
    console_.restore()
  })
})
