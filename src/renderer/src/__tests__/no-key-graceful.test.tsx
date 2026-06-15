/**
 * Tests for item 0016 — no-key graceful path in the App shell.
 *
 * When no API keys are configured, the app must not crash and should
 * surface a visible prompt directing the user to Settings.
 *
 * window.api is mocked so no real IPC or Electron is involved.
 */

import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EgressState } from '../../../shared/settings/egressState'
import { DEFAULT_SETTINGS } from '../../../shared/settings/settingsSchema'

// ---------------------------------------------------------------------------
// Mock window.api — secretHas returns false for all keys
// ---------------------------------------------------------------------------

const mockApi = {
  settingsGet: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
  settingsSet: vi.fn().mockResolvedValue({ ok: true }),
  egressState: vi.fn().mockResolvedValue({
    audio: 'cloud:Deepgram',
    notes: 'cloud:Anthropic',
  } satisfies EgressState),
  secretSet: vi.fn().mockResolvedValue({ ok: true }),
  secretHas: vi.fn().mockResolvedValue({ has: false }),
  ping: vi.fn(),
  meetingCreate: vi.fn(),
  agendaItemAdd: vi.fn(),
  agendaItemRemove: vi.fn(),
  participantAdd: vi.fn(),
  participantRemove: vi.fn(),
  meetingStart: vi.fn(),
  audioStart: vi.fn(),
  audioStop: vi.fn(),
  audioSendFrame: vi.fn(),
  onTranscriptSpan: vi.fn(() => () => undefined),
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

// ---------------------------------------------------------------------------
// Import App AFTER stubbing
// ---------------------------------------------------------------------------

const { App } = await import('../App')

describe('App — no-key graceful startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.settingsGet.mockResolvedValue(DEFAULT_SETTINGS)
    mockApi.egressState.mockResolvedValue({
      audio: 'cloud:Deepgram',
      notes: 'cloud:Anthropic',
    } satisfies EgressState)
    mockApi.secretHas.mockResolvedValue({ has: false })
  })

  it('renders without crashing when no API keys are configured', () => {
    // Should not throw
    expect(() => render(<App />)).not.toThrow()
  })

  it('shows a settings nav tab or banner when no keys are present', async () => {
    render(<App />)
    await waitFor(() => {
      const settingsNav = screen.queryByTestId('nav-settings')
      const settingsBanner = screen.queryByTestId('no-key-banner')
      expect(settingsNav !== null || settingsBanner !== null).toBe(true)
    })
  })
})
