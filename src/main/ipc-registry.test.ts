/**
 * IPC registry tests for item 0014 — Draft screen meeting/agenda/participant operations.
 *
 * Tests validate:
 * - Zod payload validation at IPC boundaries
 * - Correct delegation to repos and services
 * - Error handling on invalid payloads
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createIpcRegistry } from './ipc-registry'

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
