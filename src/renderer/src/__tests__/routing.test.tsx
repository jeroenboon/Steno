/**
 * Item 0013 — App shell routing tests.
 *
 * Coverage:
 *   1. The correct screen renders for each route value.
 *   2. Navigation (via the store's setRoute) updates the rendered screen.
 *   3. The EgressIndicator is present on Draft, Live, and Review.
 *
 * window.api is mocked: the renderer never calls real IPC in tests.
 */

import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { EgressState } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Mock window.api (the IPC bridge) — renderer must never touch real IPC
// ---------------------------------------------------------------------------

const mockEgressState: EgressState = {
  audio: 'local',
  notes: 'cloud:Anthropic',
}

vi.stubGlobal('api', {
  ping: vi.fn().mockResolvedValue({ pong: true }),
  settingsGet: vi.fn().mockResolvedValue({}),
  settingsSet: vi.fn().mockResolvedValue({ ok: true }),
  egressState: vi.fn().mockResolvedValue(mockEgressState),
  // Audio capture (item 0015)
  audioStart: vi.fn().mockResolvedValue({ ok: true }),
  audioStop: vi.fn().mockResolvedValue({ ok: true }),
  audioSendFrame: vi.fn(),
  onTranscriptSpan: vi.fn().mockReturnValue(() => undefined), // returns unsubscribe fn
  // Item push events (item 0018)
  onItemsChanged: vi.fn().mockReturnValue(() => undefined),
  onItemsSummaries: vi.fn().mockReturnValue(() => undefined),
  // Nudges (item 0019)
  onNudgesChanged: vi.fn().mockReturnValue(() => undefined),
  // Running summary (item 0020)
  onSummaryChanged: vi.fn().mockReturnValue(() => undefined),
  summaryQuery: vi.fn().mockResolvedValue({ answer: '' }),
  // Item note-taker actions (item 0018)
  itemConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemEditAndConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemDismiss: vi.fn().mockResolvedValue({ ok: true }),
  itemCreateConfirmed: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  // Meeting history (item 0023)
  meetingList: vi.fn().mockResolvedValue({ meetings: [] }),
  meetingLoad: vi.fn(),
  secretHas: vi.fn().mockResolvedValue({ has: true }),
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { App } from '../App'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderApp(): ReturnType<typeof render> {
  return render(<App />)
}

// Reset store between tests
beforeEach(() => {
  useAppStore.setState({
    route: 'draft',
    activeMeeting: null,
    micPermission: 'unknown',
    transcriptSpans: [],
  })
})

// ---------------------------------------------------------------------------
// Tests: routing
// ---------------------------------------------------------------------------

describe('App routing — screens render for each route', () => {
  it('renders the Draft screen by default', async () => {
    renderApp()
    expect(await screen.findByTestId('screen-draft')).toBeInTheDocument()
  })

  it('renders the Live screen when route is "live"', async () => {
    renderApp()
    act(() => {
      useAppStore.getState().setRoute('live')
    })
    expect(await screen.findByTestId('screen-live')).toBeInTheDocument()
  })

  it('renders the Review screen when route is "review"', async () => {
    renderApp()
    act(() => {
      useAppStore.getState().setRoute('review')
    })
    expect(await screen.findByTestId('screen-review')).toBeInTheDocument()
  })

  it('hides the Live screen when on Draft (but keeps it mounted while active)', async () => {
    useAppStore.setState({ route: 'draft', activeMeeting: 'mtg-1' })
    renderApp()
    expect(await screen.findByTestId('screen-draft')).toBeInTheDocument()
    // screen-live remains in DOM for persistent audio but is aria-hidden
    const liveLayer = document.querySelector('[aria-hidden="true"]')
    expect(liveLayer).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests: EgressIndicator presence on all screens
// ---------------------------------------------------------------------------

describe('EgressIndicator — present on every screen', () => {
  it('is rendered on the Draft screen', async () => {
    renderApp()
    expect(await screen.findByTestId('egress-indicator')).toBeInTheDocument()
  })

  it('is rendered on the Live screen', async () => {
    renderApp()
    act(() => {
      useAppStore.getState().setRoute('live')
    })
    expect(await screen.findByTestId('egress-indicator')).toBeInTheDocument()
  })

  it('is rendered on the Review screen', async () => {
    renderApp()
    act(() => {
      useAppStore.getState().setRoute('review')
    })
    expect(await screen.findByTestId('egress-indicator')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests: Live tab nav guards
// ---------------------------------------------------------------------------

describe('Live tab nav guards', () => {
  it('Live tab is disabled when no meeting is active', async () => {
    useAppStore.setState({ route: 'draft', activeMeeting: null })
    renderApp()

    const liveTab = await screen.findByRole('button', { name: /live/i })
    expect(liveTab).toBeDisabled()
  })

  it('Draft tab is disabled when a meeting is active', async () => {
    useAppStore.setState({ route: 'live', activeMeeting: 'mtg-1' })
    renderApp()

    const draftTab = await screen.findByRole('button', { name: /voorbereiding/i })
    expect(draftTab).toBeDisabled()
  })

  it('Live tab is enabled when a meeting is active', async () => {
    useAppStore.setState({ route: 'draft', activeMeeting: 'mtg-1' })
    renderApp()

    const liveTab = await screen.findByRole('button', { name: /live/i })
    expect(liveTab).not.toBeDisabled()
  })

  it('Live tab shows a recording indicator when meeting is active', async () => {
    useAppStore.setState({ route: 'home', activeMeeting: 'mtg-1' })
    renderApp()

    expect(await screen.findByTestId('nav-live-dot')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tests: LiveScreen persists while navigating other tabs
// ---------------------------------------------------------------------------

describe('LiveScreen persistent mount', () => {
  it('keeps LiveScreen in DOM when navigating away from live route', async () => {
    useAppStore.setState({ route: 'live', activeMeeting: 'mtg-1' })
    renderApp()

    expect(await screen.findByTestId('screen-live')).toBeInTheDocument()

    act(() => {
      useAppStore.getState().setRoute('home')
    })

    // screen-live stays mounted (hidden), audio continues
    expect(screen.getByTestId('screen-live')).toBeInTheDocument()
  })
})
