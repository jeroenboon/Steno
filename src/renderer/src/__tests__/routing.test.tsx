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
  useAppStore.setState({ route: 'draft', activeMeeting: null })
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

  it('does not render the Live screen when on Draft', async () => {
    renderApp()
    expect(await screen.findByTestId('screen-draft')).toBeInTheDocument()
    expect(screen.queryByTestId('screen-live')).not.toBeInTheDocument()
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
