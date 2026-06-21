/**
 * IPC registry tests for item 0014 — Draft screen meeting/agenda/participant operations.
 *
 * Tests validate:
 * - Zod payload validation at IPC boundaries
 * - Correct delegation to repos and services
 * - Error handling on invalid payloads
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { createIpcRegistry } from './ipc-registry'
import { ModelDownloader } from './providers/sherpa/ModelDownloader'

describe('IPC registry — item 0014 (meeting/agenda/participant ops)', () => {
  let registry: ReturnType<typeof createIpcRegistry>

  beforeEach(() => {
    const mockSettingsStore = {
      current: {
        asrProvider: 'deepgram' as const,
        asrModel: 'nova-2',
        extractionProvider: 'anthropic' as const,
        extractionModel: 'claude-haiku-4-5',
        extractionFinalModel: 'claude-sonnet-4-6',
        primaryLanguage: 'nl',
        customEndpoint: null,
      },
      save: async () => {
        // no-op for tests
      },
      load: async () => {
        // no-op for tests
      },
    } as unknown

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
    registry = createIpcRegistry({ settingsStore: mockSettingsStore as any })
  })

  describe('meeting:create', () => {
    it('creates a meeting in draft state', async () => {
      const payload = {
        title: 'Q3 Planning',
        primaryLanguage: 'nl',
      }

      const response = await registry.dispatch('meeting:create', payload)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('title', 'Q3 Planning')
      expect(response).toHaveProperty('state', 'draft')
      expect(response).toHaveProperty('primaryLanguage', 'nl')
    })

    it('rejects if title is empty', async () => {
      const payload = { title: '', primaryLanguage: 'nl' }

      await expect(registry.dispatch('meeting:create', payload)).rejects.toThrow()
    })
  })

  describe('agendaItem:add', () => {
    it('adds an agenda item to a draft meeting', async () => {
      const createResp = await registry.dispatch('meeting:create', {
        title: 'Test',
        primaryLanguage: 'nl',
      })

      const meetingId = (createResp as { id: string }).id

      const payload = {
        meetingId,
        title: 'Review Q3',
        topic: 'Performance review',
      }

      const response = await registry.dispatch('agendaItem:add', payload)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('title', 'Review Q3')
    })
  })

  describe('participant:add', () => {
    it('adds a participant to a draft meeting', async () => {
      const createResp = await registry.dispatch('meeting:create', {
        title: 'Test',
        primaryLanguage: 'nl',
      })

      const meetingId = (createResp as { id: string }).id

      const response = await registry.dispatch('participant:add', {
        meetingId,
        name: 'Alice',
      })

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('name', 'Alice')
    })
  })

  describe('meeting:start', () => {
    it('transitions a draft meeting to live', async () => {
      const createResp = await registry.dispatch('meeting:create', {
        title: 'Test',
        primaryLanguage: 'nl',
      })

      const meetingId = (createResp as { id: string }).id

      const response = await registry.dispatch('meeting:start', { meetingId })

      expect(response).toHaveProperty('state', 'live')
    })
  })
})

// ---------------------------------------------------------------------------
// meeting:end handler (item 0021)
// ---------------------------------------------------------------------------

describe('IPC registry — meeting:end (item 0021)', () => {
  it('calls onMeetingEnd with the meetingId and returns { ok: true }', async () => {
    const onMeetingEnd = vi.fn().mockResolvedValue(undefined)

    const mockSettingsStore = {
      current: {
        asrProvider: 'deepgram' as const,
        asrModel: 'nova-2',
        extractionProvider: 'anthropic' as const,
        extractionModel: 'claude-haiku-4-5',
        extractionFinalModel: 'claude-sonnet-4-6',
        primaryLanguage: 'nl',
        customEndpoint: null,
      },
      save: async () => {
        // no-op
      },
      load: async () => {
        // no-op
      },
    } as unknown

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
    const registry = createIpcRegistry({ settingsStore: mockSettingsStore as any, onMeetingEnd })

    const response = await registry.dispatch('meeting:end', { meetingId: 'mtg-abc' })

    expect(onMeetingEnd).toHaveBeenCalledWith('mtg-abc')
    expect(response).toEqual({ ok: true })
  })

  it('rejects when meetingId is empty', async () => {
    const onMeetingEnd = vi.fn()

    const mockSettingsStore = {
      current: {
        asrProvider: 'deepgram' as const,
        asrModel: 'nova-2',
        extractionProvider: 'anthropic' as const,
        extractionModel: 'claude-haiku-4-5',
        extractionFinalModel: 'claude-sonnet-4-6',
        primaryLanguage: 'nl',
        customEndpoint: null,
      },
      save: async () => {
        // no-op
      },
      load: async () => {
        // no-op
      },
    } as unknown

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
    const registry = createIpcRegistry({ settingsStore: mockSettingsStore as any, onMeetingEnd })

    await expect(registry.dispatch('meeting:end', { meetingId: '' })).rejects.toThrow()
    expect(onMeetingEnd).not.toHaveBeenCalled()
  })

  it('works when onMeetingEnd is not provided (graceful degradation)', async () => {
    const mockSettingsStore = {
      current: {
        asrProvider: 'deepgram' as const,
        asrModel: 'nova-2',
        extractionProvider: 'anthropic' as const,
        extractionModel: 'claude-haiku-4-5',
        extractionFinalModel: 'claude-sonnet-4-6',
        primaryLanguage: 'nl',
        customEndpoint: null,
      },
      save: async () => {
        // no-op
      },
      load: async () => {
        // no-op
      },
    } as unknown

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
    const registry = createIpcRegistry({ settingsStore: mockSettingsStore as any })

    const response = await registry.dispatch('meeting:end', { meetingId: 'mtg-xyz' })

    expect(response).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// meeting:list and meeting:load (item 0023)
// ---------------------------------------------------------------------------

describe('IPC registry — meeting:list and meeting:load (item 0023)', () => {
  const mockSettingsStore = {
    current: {
      asrProvider: 'deepgram' as const,
      asrModel: 'nova-2',
      extractionProvider: 'anthropic' as const,
      extractionModel: 'claude-haiku-4-5',
      extractionFinalModel: 'claude-sonnet-4-6',
      primaryLanguage: 'nl',
      customEndpoint: null,
    },
    save: async () => {
      // no-op
    },
    load: async () => {
      // no-op
    },
  }

  const endedMeeting = {
    id: 'mtg-ended',
    title: 'Q3 Planning',
    state: 'ended' as const,
    paused: false,
    createdAt: '2026-06-01T10:00:00.000Z',
    primaryLanguage: 'nl',
  }

  describe('meeting:list', () => {
    it('returns the list provided by the meetingList dep', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        meetingList: () => [endedMeeting],
      })

      const response = await registry.dispatch('meeting:list', {})

      expect(response).toEqual({ meetings: [endedMeeting] })
    })

    it('returns empty list when meetingList dep is absent', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
      })

      const response = await registry.dispatch('meeting:list', {})

      expect(response).toEqual({ meetings: [] })
    })
  })

  describe('meeting:load', () => {
    const fullPayload = {
      meeting: endedMeeting,
      decisions: [],
      actions: [],
      agendaItems: [],
      participants: [],
      summaries: [],
    }

    it('returns the full meeting payload when found', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        meetingLoad: (id) => (id === 'mtg-ended' ? fullPayload : null),
      })

      const response = await registry.dispatch('meeting:load', { meetingId: 'mtg-ended' })

      expect(response).toEqual(fullPayload)
    })

    it('throws when the meeting is not found', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        meetingLoad: () => null,
      })

      await expect(registry.dispatch('meeting:load', { meetingId: 'unknown' })).rejects.toThrow(
        'Meeting not found',
      )
    })

    it('throws when meetingLoad dep is absent', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
      })

      await expect(registry.dispatch('meeting:load', { meetingId: 'mtg-ended' })).rejects.toThrow(
        'meeting:load is not available',
      )
    })

    it('rejects when meetingId is empty', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        meetingLoad: () => fullPayload,
      })

      await expect(registry.dispatch('meeting:load', { meetingId: '' })).rejects.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// model:status and model:download (item 0024)
// ---------------------------------------------------------------------------

describe('IPC registry — model:status and model:download (item 0024)', () => {
  const mockSettingsStore = {
    current: {
      asrProvider: 'deepgram' as const,
      asrModel: 'nova-2',
      extractionProvider: 'anthropic' as const,
      extractionModel: 'claude-haiku-4-5',
      extractionFinalModel: 'claude-sonnet-4-6',
      primaryLanguage: 'nl',
      customEndpoint: null,
    },
    save: (): Promise<void> => Promise.resolve(),
    load: (): Promise<void> => Promise.resolve(),
  }

  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `ipc-model-test-${String(Date.now())}`)
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('model:status', () => {
    it('returns downloaded: false when no model files are present', async () => {
      const downloader = new ModelDownloader(dir, fetch, [{ name: 'model.onnx', sha256: '' }])
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        modelDownloader: downloader,
      })

      const response = await registry.dispatch('model:status', {
        modelId: 'nemotron-3.5-asr-streaming-0.6b-int4',
      })

      expect(response).toMatchObject({ downloaded: false })
    })

    it('returns downloaded: true when all expected files are present', async () => {
      writeFileSync(join(dir, 'model.onnx'), 'content')
      const downloader = new ModelDownloader(dir, fetch, [{ name: 'model.onnx', sha256: '' }])
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        modelDownloader: downloader,
      })

      const response = await registry.dispatch('model:status', {
        modelId: 'nemotron-3.5-asr-streaming-0.6b-int4',
      })

      expect(response).toMatchObject({ downloaded: true })
    })

    it('returns downloaded: false when modelDownloader is not provided', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
      })

      const response = await registry.dispatch('model:status', {
        modelId: 'nemotron-3.5-asr-streaming-0.6b-int4',
      })

      expect(response).toMatchObject({ downloaded: false })
    })
  })

  describe('model:download', () => {
    it('starts a download and emits progress events via pushModelProgress', async () => {
      const content = 'model data'
      const fakeFetch = vi.fn(() =>
        Promise.resolve(
          new Response(content, {
            headers: { 'content-length': String(content.length) },
          }),
        ),
      )

      const progressEvents: unknown[] = []
      const downloader = new ModelDownloader(dir, fakeFetch, [{ name: 'model.onnx', sha256: '' }])

      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
        modelDownloader: downloader,
        pushModelProgress: (evt) => {
          progressEvents.push(evt)
        },
      })

      const response = await registry.dispatch('model:download', {
        modelId: 'nemotron-3.5-asr-streaming-0.6b-int4',
      })

      expect(response).toEqual({ ok: true })

      // Give the async download a chance to complete
      await new Promise((r) => setTimeout(r, 100))

      const doneEvent = progressEvents.find((e) => (e as { done: boolean }).done)
      expect(doneEvent).toBeDefined()
    })

    it('throws when modelDownloader is not provided', async () => {
      const registry = createIpcRegistry({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
        settingsStore: mockSettingsStore as any,
      })

      await expect(
        registry.dispatch('model:download', { modelId: 'nemotron-3.5-asr-streaming-0.6b-int4' }),
      ).rejects.toThrow()
    })
  })
})
