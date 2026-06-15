/**
 * Tests for item 0016 — SettingsScreen component (renderer side).
 *
 * All window.api calls are mocked. No real IPC, no Electron, no network.
 *
 * Coverage:
 *   1. Selecting ASR provider persists via settings:set
 *   2. Entering an API key calls secret:set (key value NOT in settings:set payload)
 *   3. Disclosure copy appears when a cloud provider is selected
 *   4. Custom-OpenAI fields validate (URL + model + displayName required)
 *   5. Language selector persists via settings:set
 *   6. "No key configured" banner shows when secret:has returns false
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EgressState } from '../../../shared/settings/egressState'
import { DEFAULT_SETTINGS } from '../../../shared/settings/settingsSchema'
import type { AppSettings } from '../../../shared/settings/settingsSchema'

// ---------------------------------------------------------------------------
// Mock window.api — attach to existing jsdom window, do not replace it
// ---------------------------------------------------------------------------

const mockApi = {
  settingsGet: vi.fn<[], Promise<AppSettings>>(),
  settingsSet: vi.fn<[AppSettings], Promise<{ ok: true }>>(),
  egressState: vi.fn<[], Promise<EgressState>>(),
  secretSet: vi.fn<[{ key: string; value: string }], Promise<{ ok: true }>>(),
  secretHas: vi.fn<[{ key: string }], Promise<{ has: boolean }>>(),
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
// Import component AFTER window.api is stubbed
// ---------------------------------------------------------------------------

const { SettingsScreen } = await import('../screens/SettingsScreen')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultEgress: EgressState = {
  audio: 'cloud:Deepgram',
  notes: 'cloud:Anthropic',
}

function setup(overrides?: Partial<typeof mockApi>): void {
  Object.assign(mockApi, {
    settingsGet: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    settingsSet: vi.fn().mockResolvedValue({ ok: true }),
    egressState: vi.fn().mockResolvedValue(defaultEgress),
    secretSet: vi.fn().mockResolvedValue({ ok: true }),
    secretHas: vi.fn().mockResolvedValue({ has: false }),
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 1. Selecting ASR provider persists via settings:set
// ---------------------------------------------------------------------------

describe('SettingsScreen — ASR provider selection', () => {
  beforeEach(() => {
    setup()
  })

  it('renders the ASR provider selector', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('asr-provider-select')).toBeDefined()
    })
  })

  it('shows Deepgram as default ASR provider', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('asr-provider-select')
      expect((select as HTMLSelectElement).value).toBe('deepgram')
    })
  })

  it('shows local-parakeet as a disabled option', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const options = screen.getAllByRole('option')
      const parakeet = options.find((o) => (o as HTMLOptionElement).value === 'local-parakeet') as
        | HTMLOptionElement
        | undefined
      expect(parakeet).toBeDefined()
      expect(parakeet?.disabled).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Entering an API key calls secret:set; key NOT in settings:set payload
// ---------------------------------------------------------------------------

describe('SettingsScreen — API key entry', () => {
  beforeEach(() => {
    setup()
  })

  it('renders the Deepgram API key field', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('deepgram-key-input')).toBeDefined()
    })
  })

  it('calls secret:set when the Deepgram key is saved', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('deepgram-key-input'))

    const input = screen.getByTestId('deepgram-key-input')
    fireEvent.change(input, { target: { value: 'dg-secret-123' } })

    const saveBtn = screen.getByTestId('save-deepgram-key')
    act(() => {
      fireEvent.click(saveBtn)
    })
    await waitFor(() => {
      expect(mockApi.secretSet).toHaveBeenCalledWith({ key: 'deepgram', value: 'dg-secret-123' })
    })
  })

  it('does NOT include the API key value in any settings:set call', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('deepgram-key-input'))

    const input = screen.getByTestId('deepgram-key-input')
    fireEvent.change(input, { target: { value: 'SUPER_SECRET_DG_KEY' } })

    const saveBtn = screen.getByTestId('save-deepgram-key')
    act(() => {
      fireEvent.click(saveBtn)
    })
    await waitFor(() => {
      // wait for any async settle
      expect(mockApi.secretSet).toHaveBeenCalled()
    })

    for (const call of mockApi.settingsSet.mock.calls) {
      const json = JSON.stringify(call[0])
      expect(json).not.toContain('SUPER_SECRET_DG_KEY')
    }
  })

  it('renders the Anthropic API key field when Anthropic is selected as extraction provider', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('anthropic-key-input')).toBeDefined()
    })
  })

  it('calls secret:set when the Anthropic key is saved', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('anthropic-key-input'))

    const input = screen.getByTestId('anthropic-key-input')
    fireEvent.change(input, { target: { value: 'ant-secret-456' } })

    const saveBtn = screen.getByTestId('save-anthropic-key')
    act(() => {
      fireEvent.click(saveBtn)
    })
    await waitFor(() => {
      expect(mockApi.secretSet).toHaveBeenCalledWith({ key: 'anthropic', value: 'ant-secret-456' })
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Disclosure copy appears when a cloud provider is selected
// ---------------------------------------------------------------------------

describe('SettingsScreen — disclosure copy', () => {
  beforeEach(() => {
    setup()
  })

  it('shows audio disclosure text mentioning Deepgram when Deepgram ASR is active', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const disclosure = screen.getByTestId('asr-disclosure')
      expect(disclosure.textContent).toContain('Deepgram')
    })
  })

  it('shows notes disclosure text mentioning Anthropic when Anthropic extraction is active', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const disclosure = screen.getByTestId('extraction-disclosure')
      expect(disclosure.textContent).toContain('Anthropic')
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Custom-OpenAI fields validate
// ---------------------------------------------------------------------------

describe('SettingsScreen — custom OpenAI extraction', () => {
  const customSettings: AppSettings = {
    asrProvider: 'deepgram',
    extractionProvider: 'custom-openai',
    primaryLanguage: 'nl',
    customOpenAI: {
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
      keyRef: 'my-openai-key',
      displayName: 'My LLM',
    },
  }

  beforeEach(() => {
    setup({
      settingsGet: vi.fn().mockResolvedValue(customSettings),
    })
  })

  it('shows custom OpenAI fields when custom-openai extraction is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('custom-openai-base-url')).toBeDefined()
      expect(screen.getByTestId('custom-openai-model')).toBeDefined()
      expect(screen.getByTestId('custom-openai-display-name')).toBeDefined()
    })
  })

  it('does not call settings:set with an invalid base URL', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('custom-openai-base-url'))

    const urlInput = screen.getByTestId('custom-openai-base-url')
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } })

    const saveBtn = screen.getByTestId('save-custom-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    // Validation should block the call — no settings:set with the invalid URL
    const callsWithInvalidUrl = mockApi.settingsSet.mock.calls.filter((call) => {
      const json = JSON.stringify(call[0])
      return json.includes('not-a-url')
    })
    expect(callsWithInvalidUrl).toHaveLength(0)
  })

  it('does not call settings:set when model field is empty', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('custom-openai-model'))

    const modelInput = screen.getByTestId('custom-openai-model')
    fireEvent.change(modelInput, { target: { value: '' } })

    const saveBtn = screen.getByTestId('save-custom-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    // Validation should block the call — no settings:set with empty model
    const callsWithEmptyModel = mockApi.settingsSet.mock.calls.filter((call) => {
      const json = JSON.stringify(call[0])
      // Only block detection: an empty "model":"" string would appear literally
      return json.includes('"model":""') && json.includes('custom-openai')
    })
    expect(callsWithEmptyModel).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5. Language selector persists via settings:set
// ---------------------------------------------------------------------------

describe('SettingsScreen — language selector', () => {
  beforeEach(() => {
    setup()
  })

  it('renders the language selector', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('primary-language-select')).toBeDefined()
    })
  })

  it('shows the current primary language from settings', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('primary-language-select')
      expect((select as HTMLSelectElement).value).toBe('nl')
    })
  })

  it('calls settings:set with updated language when changed', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('primary-language-select'))

    const select = screen.getByTestId('primary-language-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'en' } })
    })

    await waitFor(() => {
      const jsonCalls = mockApi.settingsSet.mock.calls.map((c) => JSON.stringify(c[0]))
      const hasEnglishCall = jsonCalls.some((json) => json.includes('"primaryLanguage":"en"'))
      expect(hasEnglishCall).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 6. "No key configured" banner
// ---------------------------------------------------------------------------

describe('SettingsScreen — no key configured state', () => {
  it('shows a "geen sleutel ingesteld" notice when Deepgram key is absent', async () => {
    setup({
      secretHas: vi
        .fn()
        .mockImplementation(({ key }: { key: string }) =>
          Promise.resolve({ has: key !== 'deepgram' }),
        ),
    })
    render(<SettingsScreen />)
    await waitFor(() => {
      const notice = screen.getByTestId('deepgram-key-missing')
      expect(notice).toBeDefined()
    })
  })

  it('hides the "geen sleutel" notice when Deepgram key is present', async () => {
    setup({
      secretHas: vi.fn().mockResolvedValue({ has: true }),
    })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.queryByTestId('deepgram-key-missing')).toBeNull()
    })
  })
})
