/**
 * Live screen component tests (item 0018).
 *
 * Tests verify:
 * - Proposed items rendered under their agenda groups with source span text
 * - Proposed vs Confirmed styling distinct
 * - confirm / dismiss / edit dispatch correct IPC calls
 * - Retracted/removed item disappears from the list
 * - Manual add dispatches item:createConfirmed
 * - Keyboard shortcut: Enter confirms, Delete/Backspace dismisses focused item
 * - Transcript pane is collapsed by default
 * - Low-confidence span receives a visual flag
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { LiveScreen } from '../screens/LiveScreen'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

const mockUnsub = vi.fn()

const mockApi = {
  audioStart: vi.fn().mockResolvedValue({ ok: true }),
  audioStop: vi.fn().mockResolvedValue({ ok: true }),
  audioSendFrame: vi.fn(),
  onTranscriptSpan: vi.fn().mockReturnValue(mockUnsub),
  onItemsChanged: vi.fn().mockReturnValue(mockUnsub),
  onItemsSummaries: vi.fn().mockReturnValue(mockUnsub),
  onNudgesChanged: vi.fn().mockReturnValue(mockUnsub),
  onSummaryChanged: vi.fn().mockReturnValue(mockUnsub),
  summaryQuery: vi.fn().mockResolvedValue({ answer: '' }),
  itemConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemEditAndConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemDismiss: vi.fn().mockResolvedValue({ ok: true }),
  itemCreateConfirmed: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  onAgendaChanged: vi.fn().mockReturnValue(mockUnsub),
  agendaItemConfirm: vi.fn(),
  agendaItemEditAndConfirm: vi.fn(),
  meetingEnd: vi.fn().mockResolvedValue({ ok: true }),
  meetingPause: vi.fn().mockResolvedValue({ id: 'active-session', paused: true }),
  meetingResume: vi.fn().mockResolvedValue({ id: 'active-session', paused: false }),
  meetingCreate: vi.fn(),
  agendaItemAdd: vi.fn(),
  agendaItemRemove: vi.fn().mockResolvedValue({ ok: true }),
  participantAdd: vi.fn(),
  participantRemove: vi.fn(),
  ping: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  egressState: vi.fn(),
  secretSet: vi.fn(),
  secretHas: vi.fn(),
}

Object.assign(window, { api: mockApi })

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const AGENDA_1 = { id: 'agenda-1', title: 'Q3 Review', topic: 'Q3', state: 'confirmed' as const }
const PARTICIPANT_1 = { id: 'p-1', name: 'Alice' }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.onTranscriptSpan.mockReturnValue(mockUnsub)
  mockApi.onItemsChanged.mockReturnValue(mockUnsub)
  mockApi.onItemsSummaries.mockReturnValue(mockUnsub)
  mockApi.itemConfirm.mockResolvedValue({
    id: 'd-1',
    rationale: 'Release in Q4',
    agendaItemId: 'agenda-1',
    sourceSpanId: 'span-1',
    state: 'confirmed',
  })
  mockApi.itemDismiss.mockResolvedValue({ ok: true })
  mockApi.itemEditAndConfirm.mockResolvedValue({
    id: 'd-1',
    rationale: 'Updated',
    agendaItemId: 'agenda-1',
    sourceSpanId: 'span-1',
    state: 'confirmed',
  })
  mockApi.itemCreateConfirmed.mockResolvedValue({
    id: 'd-new',
    rationale: 'Nieuw besluit',
    agendaItemId: '__off-agenda__',
    sourceSpanId: 'span-manual',
    state: 'confirmed',
  })

  useAppStore.setState({
    route: 'live',
    activeMeeting: 'active-session',
    liveMeetingId: 'active-session',
    micPermission: 'unknown',
    transcriptSpans: [],
    transcriptOpen: true,
    captureMode: 'remote',
    loopbackState: null,
    proposedDecisions: [],
    proposedActions: [],
    confirmedDecisions: [],
    confirmedActions: [],
    agendaItems: [AGENDA_1],
    participants: [PARTICIPANT_1],
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Header behaviour (title, pause/resume, the finalising overlay + its
// stale-overlay clearing) is covered in LiveHeader.test.tsx now that the header
// is its own store-connected component (A1).

describe('LiveScreen — guard: no active meeting', () => {
  it('shows empty state when activeMeeting is null', async () => {
    useAppStore.setState({ activeMeeting: null, route: 'live' })
    render(<LiveScreen />)

    expect(await screen.findByTestId('live-noactive')).toBeInTheDocument()
    expect(screen.queryByTestId('end-meeting-btn')).not.toBeInTheDocument()
  })

  it('does not start audio capture when no live meeting is in progress', async () => {
    useAppStore.setState({ activeMeeting: null, liveMeetingId: null, route: 'live' })
    render(<LiveScreen />)

    await screen.findByTestId('live-noactive')
    expect(mockApi.audioStart).not.toHaveBeenCalled()
  })

  // Regression (item 0024): App mounts LiveScreen permanently — its audio-start
  // effect first runs at startup with no live meeting and bails. When a meeting
  // later goes live the effect MUST re-fire and call start(). It only does so if
  // the live-meeting id is in the effect's dependency array.
  it('starts audio capture when a meeting goes live after mount', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no media device in jsdom'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    // Mount with no live meeting, exactly as App does at startup.
    useAppStore.setState({ activeMeeting: null, liveMeetingId: null, route: 'live' })
    render(<LiveScreen />)
    await screen.findByTestId('live-noactive')
    expect(getUserMedia).not.toHaveBeenCalled()

    // Meeting goes live (Draft → "Start vergadering" sets both ids).
    act(() => {
      useAppStore.setState({ activeMeeting: 'active-session', liveMeetingId: 'active-session' })
    })

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled()
    })
  })

  // Regression (import / reopen bug): loading a meeting for Review sets
  // activeMeeting but NOT liveMeetingId. Capture must stay off — otherwise an
  // import (or reopening a past meeting) silently starts a live mic session.
  it('does not start audio capture when a meeting is only loaded for review', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no media device in jsdom'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    useAppStore.setState({
      activeMeeting: 'imported-meeting',
      liveMeetingId: null,
      route: 'review',
    })
    render(<LiveScreen />)

    // Give any (incorrect) start effect a chance to fire.
    await Promise.resolve()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(mockApi.audioStart).not.toHaveBeenCalled()
  })
})

describe('LiveScreen — item 0018 items UI', () => {
  it('renders the live screen', () => {
    render(<LiveScreen />)
    expect(screen.getByTestId('screen-live')).toBeInTheDocument()
  })

  // Item rendering, confirm/dismiss/edit/manual-add and keyboard shortcuts are
  // covered in LiveItemsPanel.test.tsx; transcript-pane behaviour in
  // TranscriptPane.test.tsx (A1). The orchestrator keeps only the layout/session
  // concerns below.

  // -------------------------------------------------------------------------
  // Recording-gated bleed class (D4)
  // -------------------------------------------------------------------------

  it('does NOT have screen--live--recording when micPermission is unknown', () => {
    useAppStore.setState({ micPermission: 'unknown' })
    render(<LiveScreen />)
    const el = screen.getByTestId('screen-live')
    expect(el).not.toHaveClass('screen--live--recording')
  })

  it('does NOT have screen--live--recording when micPermission is denied', () => {
    useAppStore.setState({ micPermission: 'denied' })
    render(<LiveScreen />)
    const el = screen.getByTestId('screen-live')
    expect(el).not.toHaveClass('screen--live--recording')
  })

  it('adds screen--live--recording when micPermission is granted', async () => {
    render(<LiveScreen />)
    // Simulate audio capture grant arriving after mount
    useAppStore.setState({ micPermission: 'granted' })
    // findBy* re-evaluates after re-render
    await waitFor(() => {
      expect(screen.getByTestId('screen-live')).toHaveClass('screen--live--recording')
    })
  })
})

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

// Pause/resume controls are covered in LiveHeader.test.tsx (A1).

// Live agenda grooming (ADR 0029) is covered in LiveItemsPanel.test.tsx (A1).
