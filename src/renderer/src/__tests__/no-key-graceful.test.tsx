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
import type { AppSettings } from '../../../shared/settings/settingsSchema'
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
  audioStart: vi.fn(),
  audioStop: vi.fn(),
  audioSendFrame: vi.fn(),
  onTranscriptSpan: vi.fn(() => () => undefined),
  onItemsChanged: vi.fn(() => () => undefined),
  onAsrTerminal: vi.fn(() => () => undefined),
  meetingList: vi.fn().mockResolvedValue({ meetings: [] }),
  meetingLoad: vi.fn(),
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

// ---------------------------------------------------------------------------
// Banner derivation from keyRefs (audit C7) — the banner must reflect the keyRef
// each configured provider actually needs, across ALL provider combinations,
// not just the two the old hand-rolled logic covered.
// ---------------------------------------------------------------------------

describe('App — no-key banner derives required keys from keyRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.egressState.mockResolvedValue({
      audio: 'cloud:Deepgram',
      notes: 'cloud:Anthropic',
    } satisfies EgressState)
  })

  it('shows the banner for an Azure OpenAI extractor whose key is missing (old logic missed this)', async () => {
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'my-gpt-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-openai',
        displayName: 'Azure OpenAI',
      },
    }
    mockApi.settingsGet.mockResolvedValue(settings)
    // The azure-openai key is absent; every other lookup would report present.
    mockApi.secretHas.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ has: key !== 'azure-openai' }),
    )

    render(<App />)
    await waitFor(() => {
      expect(screen.queryByTestId('no-key-banner')).not.toBeNull()
    })
  })

  it('shows the banner for an OpenAI-audio ASR whose key is missing (old logic missed this)', async () => {
    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: {
        model: 'gpt-4o-mini-transcribe',
        keyRef: 'openai',
        displayName: 'OpenAI Audio',
      },
    }
    mockApi.settingsGet.mockResolvedValue(settings)
    // anthropic key present, the openai ASR key missing.
    mockApi.secretHas.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ has: key === 'anthropic' }),
    )

    render(<App />)
    await waitFor(() => {
      expect(screen.queryByTestId('no-key-banner')).not.toBeNull()
    })
  })

  it('does not show the banner when all required keys for the combination are present', async () => {
    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'https://my-resource.openai.azure.com/',
        deployment: 'my-gpt-deployment',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-4o',
        keyRef: 'azure-openai',
        displayName: 'Azure OpenAI',
      },
      openaiAudio: {
        model: 'gpt-4o-mini-transcribe',
        keyRef: 'openai',
        displayName: 'OpenAI Audio',
      },
    }
    mockApi.settingsGet.mockResolvedValue(settings)
    mockApi.secretHas.mockResolvedValue({ has: true })

    render(<App />)
    // Give the effect time to resolve, then assert the banner never appears.
    await waitFor(() => {
      expect(mockApi.secretHas).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.queryByTestId('no-key-banner')).toBeNull()
    })
  })

  it('does not require a key for a local-parakeet + Anthropic combo once Anthropic is set', async () => {
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    mockApi.settingsGet.mockResolvedValue(settings)
    mockApi.secretHas.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ has: key === 'anthropic' }),
    )

    render(<App />)
    await waitFor(() => {
      expect(mockApi.secretHas).toHaveBeenCalledWith({ key: 'anthropic' })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('no-key-banner')).toBeNull()
    })
  })
})
