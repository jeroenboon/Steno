/**
 * Tests for useLiveSession (architecture task 2).
 *
 * The hook owns the renderer-side live session: create AudioCaptureService,
 * subscribe to the five main→renderer push channels, start capture, and tear it
 * all down. These tests exercise that orchestration in isolation (renderHook +
 * mocked window.api) rather than through the whole LiveScreen.
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLiveSession } from '../screens/useLiveSession'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Mock window.api — each push channel gets its own unsubscribe spy so we can
// assert every subscription is torn down on unmount.
// ---------------------------------------------------------------------------

const unsubSpan = vi.fn()
const unsubItems = vi.fn()
const unsubNudges = vi.fn()
const unsubAgenda = vi.fn()
const unsubSummary = vi.fn()
const unsubSummaries = vi.fn()

const mockApi = {
  audioStart: vi.fn().mockResolvedValue({ ok: true }),
  audioStop: vi.fn().mockResolvedValue({ ok: true }),
  audioSendFrame: vi.fn(),
  onTranscriptSpan: vi.fn().mockReturnValue(unsubSpan),
  onItemsChanged: vi.fn().mockReturnValue(unsubItems),
  onNudgesChanged: vi.fn().mockReturnValue(unsubNudges),
  onAgendaChanged: vi.fn().mockReturnValue(unsubAgenda),
  onSummaryChanged: vi.fn().mockReturnValue(unsubSummary),
  onItemsSummaries: vi.fn().mockReturnValue(unsubSummaries),
}

Object.assign(window, { api: mockApi })

// jsdom has no real media devices; reject so service.start() bails after mic.
const getUserMedia = vi.fn().mockRejectedValue(new Error('no media device in jsdom'))

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.onTranscriptSpan.mockReturnValue(unsubSpan)
  mockApi.onItemsChanged.mockReturnValue(unsubItems)
  mockApi.onNudgesChanged.mockReturnValue(unsubNudges)
  mockApi.onAgendaChanged.mockReturnValue(unsubAgenda)
  mockApi.onSummaryChanged.mockReturnValue(unsubSummary)
  mockApi.onItemsSummaries.mockReturnValue(unsubSummaries)

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })

  useAppStore.setState({
    captureMode: 'mic-only',
    transcriptSpans: [],
    micPermission: 'unknown',
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLiveSession', () => {
  it('does not start capture when activeMeeting is null', () => {
    renderHook(() => useLiveSession(null))

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(mockApi.onTranscriptSpan).not.toHaveBeenCalled()
  })

  it('starts capture when activeMeeting changes from null to an id', async () => {
    const { rerender } = renderHook(({ meeting }) => useLiveSession(meeting), {
      initialProps: { meeting: null as string | null },
    })

    expect(getUserMedia).not.toHaveBeenCalled()

    act(() => {
      rerender({ meeting: 'active-session' })
    })

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled()
    })
    // All capture-scoped push channels are subscribed once the session starts.
    // Items are reconciled app-wide (App.tsx), not here (ADR 0033).
    expect(mockApi.onTranscriptSpan).toHaveBeenCalled()
    expect(mockApi.onNudgesChanged).toHaveBeenCalled()
    expect(mockApi.onAgendaChanged).toHaveBeenCalled()
    expect(mockApi.onSummaryChanged).toHaveBeenCalled()
    expect(mockApi.onItemsSummaries).toHaveBeenCalled()
  })

  it('unsubscribes every channel and stops the service on unmount', async () => {
    const { unmount } = renderHook(() => useLiveSession('active-session'))

    // Let the async service.start() settle (it rejects on getUserMedia).
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled()
    })

    unmount()

    expect(unsubSpan).toHaveBeenCalledTimes(1)
    expect(unsubNudges).toHaveBeenCalledTimes(1)
    expect(unsubAgenda).toHaveBeenCalledTimes(1)
    expect(unsubSummary).toHaveBeenCalledTimes(1)
    expect(unsubSummaries).toHaveBeenCalledTimes(1)
    // service.stop() forwards to main via audio:stop.
    await waitFor(() => {
      expect(mockApi.audioStop).toHaveBeenCalled()
    })
  })

  it('drops a transcript span that fails Zod validation (no store write)', () => {
    renderHook(() => useLiveSession('active-session'))

    const raw: unknown = mockApi.onTranscriptSpan.mock.calls[0]?.[0]
    const cb = raw as ((p: unknown) => void) | undefined
    expect(cb).toBeDefined()

    act(() => {
      cb?.({ not: 'a valid span' })
    })

    expect(useAppStore.getState().transcriptSpans).toHaveLength(0)
  })

  it('writes a valid transcript span to the store', () => {
    renderHook(() => useLiveSession('active-session'))

    const raw: unknown = mockApi.onTranscriptSpan.mock.calls[0]?.[0]
    const cb = raw as ((p: unknown) => void) | undefined

    act(() => {
      cb?.({ id: 'span-1', text: 'hallo', startMs: 0, endMs: 100, isFinal: true })
    })

    expect(useAppStore.getState().transcriptSpans).toHaveLength(1)
  })
})
