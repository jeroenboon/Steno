/**
 * IPC handler tests for note-taker item actions (item 0018).
 *
 * Verifies that the four note-taker action channels:
 *   item:confirm          — confirm a Proposed item
 *   item:editAndConfirm   — edit + confirm in one step
 *   item:dismiss          — dismiss a Proposed item
 *   item:createConfirmed  — manual add → directly Confirmed
 *
 * ...validate their Zod schemas, call ItemLifecycleService correctly,
 * and reject unknown/invalid payloads.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createIpcRegistry } from '../ipc-registry'

// ---------------------------------------------------------------------------
// Minimal mock of ItemLifecycleService
// ---------------------------------------------------------------------------

const mockDecision = {
  id: 'd-1',
  rationale: 'We will ship in Q4',
  agendaItemId: 'agenda-1',
  sourceSpanId: 'span-1',
  state: 'proposed' as const,
}

const mockAction = {
  id: 'a-1',
  agendaItemId: 'agenda-1',
  sourceSpanId: 'span-1',
  status: 'open' as const,
  state: 'proposed' as const,
}

const mockItemLifecycleService = {
  confirm: vi.fn(),
  editAndConfirmDecision: vi.fn(),
  editAndConfirmAction: vi.fn(),
  dismiss: vi.fn(),
  createConfirmedDecision: vi.fn(),
  createConfirmedAction: vi.fn(),
}

// ---------------------------------------------------------------------------
// Minimal mock of settings store
// ---------------------------------------------------------------------------

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
  save: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue(undefined),
}

describe('IPC registry — item 0018 note-taker action channels', () => {
  let registry: ReturnType<typeof createIpcRegistry>

  beforeEach(() => {
    vi.clearAllMocks()

    mockItemLifecycleService.confirm.mockReturnValue({ ...mockDecision, state: 'confirmed' })
    mockItemLifecycleService.editAndConfirmDecision.mockReturnValue({
      ...mockDecision,
      rationale: 'Updated rationale',
      state: 'confirmed',
    })
    mockItemLifecycleService.editAndConfirmAction.mockReturnValue({
      ...mockAction,
      owner: 'p-1',
      state: 'confirmed',
    })
    mockItemLifecycleService.dismiss.mockReturnValue(undefined)
    mockItemLifecycleService.createConfirmedDecision.mockReturnValue({
      ...mockDecision,
      id: 'd-new',
      state: 'confirmed',
    })
    mockItemLifecycleService.createConfirmedAction.mockReturnValue({
      ...mockAction,
      id: 'a-new',
      state: 'confirmed',
    })

    registry = createIpcRegistry({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      settingsStore: mockSettingsStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      itemLifecycleService: mockItemLifecycleService as any,
    })
  })

  // -------------------------------------------------------------------------
  // item:confirm
  // -------------------------------------------------------------------------

  describe('item:confirm', () => {
    it('confirms a proposed decision via ItemLifecycleService', async () => {
      const payload = { kind: 'decision', id: 'd-1' }
      const result = await registry.dispatch('item:confirm', payload)

      expect(mockItemLifecycleService.confirm).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
      expect(result).toHaveProperty('state', 'confirmed')
    })

    it('confirms a proposed action via ItemLifecycleService', async () => {
      mockItemLifecycleService.confirm.mockReturnValue({ ...mockAction, state: 'confirmed' })
      const payload = { kind: 'action', id: 'a-1' }
      const result = await registry.dispatch('item:confirm', payload)

      expect(mockItemLifecycleService.confirm).toHaveBeenCalledWith({ kind: 'action', id: 'a-1' })
      expect(result).toHaveProperty('state', 'confirmed')
    })

    it('rejects if kind is missing', async () => {
      await expect(registry.dispatch('item:confirm', { id: 'd-1' })).rejects.toThrow()
    })

    it('rejects if kind is unknown', async () => {
      await expect(
        registry.dispatch('item:confirm', { kind: 'nudge', id: 'd-1' }),
      ).rejects.toThrow()
    })

    it('rejects if id is empty', async () => {
      await expect(
        registry.dispatch('item:confirm', { kind: 'decision', id: '' }),
      ).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // item:editAndConfirm
  // -------------------------------------------------------------------------

  describe('item:editAndConfirm', () => {
    it('edits and confirms a decision', async () => {
      const payload = {
        kind: 'decision',
        id: 'd-1',
        updates: { rationale: 'Updated rationale' },
      }
      const result = await registry.dispatch('item:editAndConfirm', payload)

      expect(mockItemLifecycleService.editAndConfirmDecision).toHaveBeenCalledWith('d-1', {
        rationale: 'Updated rationale',
      })
      expect(result).toHaveProperty('rationale', 'Updated rationale')
      expect(result).toHaveProperty('state', 'confirmed')
    })

    it('edits and confirms an action', async () => {
      const payload = {
        kind: 'action',
        id: 'a-1',
        updates: { owner: 'p-1' },
      }
      const result = await registry.dispatch('item:editAndConfirm', payload)

      expect(mockItemLifecycleService.editAndConfirmAction).toHaveBeenCalledWith('a-1', {
        owner: 'p-1',
      })
      expect(result).toHaveProperty('owner', 'p-1')
      expect(result).toHaveProperty('state', 'confirmed')
    })

    it('rejects if kind is missing', async () => {
      await expect(
        registry.dispatch('item:editAndConfirm', { id: 'd-1', updates: {} }),
      ).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // item:dismiss
  // -------------------------------------------------------------------------

  describe('item:dismiss', () => {
    it('dismisses a proposed decision', async () => {
      const payload = { kind: 'decision', id: 'd-1' }
      const result = await registry.dispatch('item:dismiss', payload)

      expect(mockItemLifecycleService.dismiss).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
      expect(result).toHaveProperty('ok', true)
    })

    it('dismisses a proposed action', async () => {
      const payload = { kind: 'action', id: 'a-1' }
      const result = await registry.dispatch('item:dismiss', payload)

      expect(mockItemLifecycleService.dismiss).toHaveBeenCalledWith({ kind: 'action', id: 'a-1' })
      expect(result).toHaveProperty('ok', true)
    })

    it('rejects if id is empty', async () => {
      await expect(
        registry.dispatch('item:dismiss', { kind: 'decision', id: '' }),
      ).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // item:createConfirmed
  // -------------------------------------------------------------------------

  describe('item:createConfirmed', () => {
    it('creates a confirmed decision manually', async () => {
      const payload = {
        kind: 'decision',
        meetingId: 'active-session',
        item: {
          id: 'd-new',
          rationale: 'Manual decision',
          agendaItemId: 'agenda-1',
          sourceSpanId: 'span-1',
        },
      }
      const result = await registry.dispatch('item:createConfirmed', payload)

      expect(mockItemLifecycleService.createConfirmedDecision).toHaveBeenCalledWith(
        'active-session',
        expect.objectContaining({ rationale: 'Manual decision' }),
      )
      expect(result).toHaveProperty('state', 'confirmed')
    })

    it('creates a confirmed action manually', async () => {
      const payload = {
        kind: 'action',
        meetingId: 'active-session',
        item: {
          id: 'a-new',
          agendaItemId: 'agenda-1',
          sourceSpanId: 'span-1',
          status: 'open',
        },
      }
      const result = await registry.dispatch('item:createConfirmed', payload)

      expect(mockItemLifecycleService.createConfirmedAction).toHaveBeenCalledWith(
        'active-session',
        expect.objectContaining({ status: 'open' }),
      )
      expect(result).toHaveProperty('state', 'confirmed')
    })

    it('rejects if meetingId is empty', async () => {
      await expect(
        registry.dispatch('item:createConfirmed', {
          kind: 'decision',
          meetingId: '',
          item: { id: 'd-1', rationale: 'x', agendaItemId: 'a', sourceSpanId: 's' },
        }),
      ).rejects.toThrow()
    })
  })
})
