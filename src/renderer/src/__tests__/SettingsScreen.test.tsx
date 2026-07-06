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
import { captureConsole } from '../../../shared/testing/captureConsole'

// ---------------------------------------------------------------------------
// Mock window.api — attach to existing jsdom window, do not replace it
// ---------------------------------------------------------------------------

const mockApi = {
  settingsGet: vi.fn<[], Promise<AppSettings>>(),
  settingsSet: vi.fn<[AppSettings], Promise<{ ok: true }>>(),
  egressState: vi.fn<[], Promise<EgressState>>(),
  secretSet: vi.fn<[{ key: string; value: string }], Promise<{ ok: true }>>(),
  secretHas: vi.fn<[{ key: string }], Promise<{ has: boolean }>>(),
  providerTestConnection: vi.fn(() => Promise.resolve({ ok: true })),
  modelStatus: vi.fn<
    [{ modelId: string }],
    Promise<{ modelId: string; downloaded: boolean; sizeBytes: number }>
  >(),
  modelDownload: vi.fn<[{ modelId: string }], Promise<{ ok: true }>>(),
  onModelProgress: vi.fn(() => () => undefined),
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
    modelStatus: vi.fn().mockResolvedValue({
      modelId: 'whisper-small-sherpa',
      downloaded: false,
      sizeBytes: 0,
    }),
    modelDownload: vi.fn().mockResolvedValue({ ok: true }),
    onModelProgress: vi.fn(() => () => undefined),
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 1. Selecting ASR provider persists via settings:set
// ---------------------------------------------------------------------------

describe('SettingsScreen — ASR provider selection (Phase 0.4 role-card)', () => {
  beforeEach(() => {
    setup()
  })

  it('renders the ASR provider role card with grouped select', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('asr-provider-select')).toBeDefined()
    })
  })

  it('shows Deepgram (cloud) as the default ASR selection', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('asr-provider-select')
      expect((select as HTMLSelectElement).value).toBe('deepgram')
    })
  })

  it('offers a local (on-device) option', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('asr-provider-select')
      const localOption = Array.from((select as HTMLSelectElement).options).find(
        (o) => o.value === 'local-parakeet',
      )
      expect(localOption).toBeDefined()
    })
  })

  it('persists the ASR provider via settings:set when local is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))

    const select = screen.getByTestId('asr-provider-select')
    fireEvent.change(select, { target: { value: 'local-parakeet' } })

    await waitFor(() => {
      const jsonCalls = mockApi.settingsSet.mock.calls.map((c) => JSON.stringify(c[0]))
      expect(jsonCalls.some((j) => j.includes('"asrProvider":"local-parakeet"'))).toBe(true)
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
    extractionProvider: 'openai-compatible',
    primaryLanguage: 'nl',
    openaiCompatible: {
      preset: 'custom',
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

  it('shows custom OpenAI fields when openai-compatible extraction is selected', async () => {
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
      return json.includes('"model":""') && json.includes('openai-compatible')
    })
    expect(callsWithEmptyModel).toHaveLength(0)
  })
})

describe('SettingsScreen — shared vendor key notice (Phase 5.2)', () => {
  const sharedOpenAI: AppSettings = {
    asrProvider: 'openai-audio',
    extractionProvider: 'openai-compatible',
    primaryLanguage: 'nl',
    openaiAudio: { model: 'gpt-4o-mini-transcribe', keyRef: 'openai', displayName: 'OpenAI' },
    openaiCompatible: {
      preset: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      keyRef: 'openai',
      displayName: 'OpenAI',
    },
  }

  it('shows the shared-key notice in the extraction panel when both roles use one key', async () => {
    setup({ settingsGet: vi.fn().mockResolvedValue(sharedOpenAI) })
    render(<SettingsScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('shared-key-custom')).toBeDefined()
    })
  })

  it('does not show the shared-key notice for the default (unshared) config', async () => {
    setup()
    render(<SettingsScreen />)

    await waitFor(() => screen.getByTestId('asr-provider-select'))
    expect(screen.queryByTestId('shared-key-audio')).toBeNull()
    expect(screen.queryByTestId('shared-key-custom')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. Language selector persists via settings:set
// ---------------------------------------------------------------------------

describe('SettingsScreen — language selector (Phase 0.4)', () => {
  beforeEach(() => {
    setup()
  })

  it('renders the language select dropdown', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('language-select')).toBeDefined()
    })
  })

  it('shows the current primary language from settings', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('language-select')
      expect((select as HTMLSelectElement).value).toBe('nl')
    })
  })

  it('calls settings:set with updated language when changed', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('language-select'))

    const select = screen.getByTestId('language-select')
    fireEvent.change(select, { target: { value: 'en' } })

    await waitFor(() => {
      const jsonCalls = mockApi.settingsSet.mock.calls.map((c) => JSON.stringify(c[0]))
      const hasEnglishCall = jsonCalls.some((json) => json.includes('"primaryLanguage":"en"'))
      expect(hasEnglishCall).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Saved-key status (positive confirmation a key exists)
// ---------------------------------------------------------------------------

describe('SettingsScreen — saved key status', () => {
  it('shows a saved-key status (and no input) when the Deepgram key is present', async () => {
    setup({ secretHas: vi.fn().mockResolvedValue({ has: true }) })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('deepgram-key-status')).toBeDefined()
      expect(screen.queryByTestId('deepgram-key-input')).toBeNull()
    })
  })

  it('reveals the input again when "Vervangen" is clicked', async () => {
    setup({ secretHas: vi.fn().mockResolvedValue({ has: true }) })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('replace-deepgram-key'))

    act(() => {
      fireEvent.click(screen.getByTestId('replace-deepgram-key'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('deepgram-key-input')).toBeDefined()
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

// ---------------------------------------------------------------------------
// 7. Local model download UI (item 0024)
// ---------------------------------------------------------------------------

describe('SettingsScreen — local model download (item 0024)', () => {
  const parakeetSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    asrProvider: 'local-parakeet',
  }

  it('shows the download section when Parakeet is selected and model is not downloaded', async () => {
    setup({
      settingsGet: vi.fn().mockResolvedValue(parakeetSettings),
      modelStatus: vi.fn().mockResolvedValue({
        modelId: 'whisper-small-sherpa',
        downloaded: false,
        sizeBytes: 0,
      }),
    })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('model-download-section')).toBeDefined()
    })
  })

  it('download button calls modelDownload when clicked', async () => {
    setup({
      settingsGet: vi.fn().mockResolvedValue(parakeetSettings),
      modelStatus: vi.fn().mockResolvedValue({
        modelId: 'whisper-small-sherpa',
        downloaded: false,
        sizeBytes: 0,
      }),
      modelDownload: vi.fn().mockResolvedValue({ ok: true }),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('download-model-btn'))

    act(() => {
      fireEvent.click(screen.getByTestId('download-model-btn'))
    })

    await waitFor(() => {
      expect(mockApi.modelDownload).toHaveBeenCalledWith({
        modelId: 'whisper-small-sherpa',
      })
    })
  })

  it('shows the installed section when model is already downloaded', async () => {
    setup({
      settingsGet: vi.fn().mockResolvedValue(parakeetSettings),
      modelStatus: vi.fn().mockResolvedValue({
        modelId: 'whisper-small-sherpa',
        downloaded: true,
        sizeBytes: 350_000_000,
      }),
    })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('model-installed-section')).toBeDefined()
      expect(screen.queryByTestId('model-download-section')).toBeNull()
    })
  })

  it('shows progress bar after onModelProgress event with done: false', async () => {
    let progressCallback: ((evt: import('../../../shared/ipc').ModelProgressEvent) => void) | null =
      null

    setup({
      settingsGet: vi.fn().mockResolvedValue(parakeetSettings),
      modelStatus: vi.fn().mockResolvedValue({
        modelId: 'whisper-small-sherpa',
        downloaded: false,
        sizeBytes: 0,
      }),
      onModelProgress: vi.fn(
        (cb: (evt: import('../../../shared/ipc').ModelProgressEvent) => void) => {
          progressCallback = cb
          return () => undefined
        },
      ),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('model-download-section'))

    act(() => {
      progressCallback?.({
        modelId: 'whisper-small-sherpa',
        bytesReceived: 50_000,
        bytesTotal: 100_000,
        done: false,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('model-progress')).toBeDefined()
    })
  })

  it('hides download section when onModelProgress fires with done: true (no error)', async () => {
    let progressCallback: ((evt: import('../../../shared/ipc').ModelProgressEvent) => void) | null =
      null

    setup({
      settingsGet: vi.fn().mockResolvedValue(parakeetSettings),
      modelStatus: vi.fn().mockResolvedValue({
        modelId: 'whisper-small-sherpa',
        downloaded: false,
        sizeBytes: 0,
      }),
      onModelProgress: vi.fn(
        (cb: (evt: import('../../../shared/ipc').ModelProgressEvent) => void) => {
          progressCallback = cb
          return () => undefined
        },
      ),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('model-download-section'))

    act(() => {
      progressCallback?.({
        modelId: 'whisper-small-sherpa',
        bytesReceived: 100_000,
        bytesTotal: 100_000,
        done: true,
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('model-download-section')).toBeNull()
      expect(screen.getByTestId('model-installed-section')).toBeDefined()
    })
  })
})

// ---------------------------------------------------------------------------
// Phase 1.2: Preset-driven field prefill (OpenAI / Mistral)
// ---------------------------------------------------------------------------

describe('SettingsScreen — extraction provider presets (Phase 1.2)', () => {
  beforeEach(() => {
    setup()
  })

  it('offers OpenAI as a selection option in the extraction provider select', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('extraction-provider-select')
      const openaiOption = Array.from((select as HTMLSelectElement).options).find(
        (o) => o.value === 'openai',
      )
      expect(openaiOption).toBeDefined()
    })
  })

  it('offers Mistral as a selection option in the extraction provider select', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('extraction-provider-select')
      const mistralOption = Array.from((select as HTMLSelectElement).options).find(
        (o) => o.value === 'mistral',
      )
      expect(mistralOption).toBeDefined()
    })
  })

  it('prefills baseUrl and model when OpenAI is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'openai' } })
    })

    await waitFor(() => {
      const baseUrlInput = screen.getByTestId('custom-openai-base-url')
      const modelInput = screen.getByTestId('custom-openai-model')
      expect((baseUrlInput as HTMLInputElement).value).toBe('https://api.openai.com/v1')
      expect((modelInput as HTMLInputElement).value).toBe('gpt-4o-mini')
    })
  })

  it('prefills baseUrl and model when Mistral is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'mistral' } })
    })

    await waitFor(() => {
      const baseUrlInput = screen.getByTestId('custom-openai-base-url')
      const modelInput = screen.getByTestId('custom-openai-model')
      expect((baseUrlInput as HTMLInputElement).value).toBe('https://api.mistral.ai/v1')
      expect((modelInput as HTMLInputElement).value).toBe('mistral-medium-3.5')
    })
  })

  it('sets keyRef to "openai" when OpenAI preset is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'openai' } })
    })

    const saveBtn = screen.getByTestId('save-custom-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return json.includes('"keyRef":"openai"')
        }),
      ).toBe(true)
    })
  })

  it('sets keyRef to "mistral" when Mistral preset is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'mistral' } })
    })

    const saveBtn = screen.getByTestId('save-custom-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return json.includes('"keyRef":"mistral"')
        }),
      ).toBe(true)
    })
  })

  it('persists settings with preset tag when OpenAI is selected and saved', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'openai' } })
    })

    const saveBtn = screen.getByTestId('save-custom-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return (
            json.includes('"preset":"openai"') &&
            json.includes('"extractionProvider":"openai-compatible"')
          )
        }),
      ).toBe(true)
    })
  })

  it('persists settings with preset tag when Mistral is selected and saved', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'mistral' } })
    })

    const saveBtn = screen.getByTestId('save-custom-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return (
            json.includes('"preset":"mistral"') &&
            json.includes('"extractionProvider":"openai-compatible"')
          )
        }),
      ).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Local extraction provider (ADR 0040)
// ---------------------------------------------------------------------------

describe('SettingsScreen — local extraction', () => {
  beforeEach(() => {
    setup()
  })

  it('offers a local (on-device) extraction option', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })
    const select = screen.getByTestId('extraction-provider-select')
    const localOption = Array.from((select as HTMLSelectElement).options).find(
      (o) => o.value === 'local',
    )
    expect(localOption).toBeDefined()
  })

  it('reveals the local config fields when local is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'local' } })
    })

    await waitFor(() => {
      expect(screen.getByTestId('local-base-url')).toBeDefined()
      expect(screen.getByTestId('local-model')).toBeDefined()
    })
  })

  it('persists extractionProvider "local" with the entered base URL + model on save', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'local' } })
    })

    await waitFor(() => screen.getByTestId('local-model'))
    act(() => {
      fireEvent.change(screen.getByTestId('local-base-url'), {
        target: { value: 'http://localhost:1234/v1' },
      })
      fireEvent.change(screen.getByTestId('local-model'), { target: { value: 'my-local-model' } })
    })

    act(() => {
      fireEvent.click(screen.getByTestId('save-local'))
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return (
            json.includes('"extractionProvider":"local"') &&
            json.includes('"model":"my-local-model"') &&
            json.includes('"preset":"local-custom"')
          )
        }),
      ).toBe(true)
    })
  })

  it('does not send an API key in the settings:set payload for local', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))

    act(() => {
      fireEvent.change(screen.getByTestId('extraction-provider-select'), {
        target: { value: 'local' },
      })
    })
    await waitFor(() => screen.getByTestId('local-model'))
    act(() => {
      fireEvent.change(screen.getByTestId('local-model'), { target: { value: 'm' } })
    })
    act(() => {
      fireEvent.click(screen.getByTestId('save-local'))
    })

    await waitFor(() => {
      expect(mockApi.settingsSet).toHaveBeenCalled()
    })
    for (const call of mockApi.settingsSet.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('secret')
    }
  })

  it('offers a runtime preset picker with LM Studio, Ollama and llama.cpp', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))
    act(() => {
      fireEvent.change(screen.getByTestId('extraction-provider-select'), {
        target: { value: 'local' },
      })
    })

    await waitFor(() => screen.getByTestId('local-preset'))
    const picker = screen.getByTestId('local-preset')
    const values = Array.from((picker as HTMLSelectElement).options).map((o) => o.value)
    expect(values).toEqual(['lmstudio', 'ollama', 'llamacpp', 'local-custom'])
  })

  it('prefills the base URL from the chosen runtime preset', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))
    act(() => {
      fireEvent.change(screen.getByTestId('extraction-provider-select'), {
        target: { value: 'local' },
      })
    })

    await waitFor(() => screen.getByTestId('local-preset'))
    act(() => {
      fireEvent.change(screen.getByTestId('local-preset'), { target: { value: 'ollama' } })
    })

    await waitFor(() => {
      const baseUrl = screen.getByTestId('local-base-url')
      expect((baseUrl as HTMLInputElement).value).toBe('http://localhost:11434/v1')
    })
  })

  it('persists the chosen preset on save', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))
    act(() => {
      fireEvent.change(screen.getByTestId('extraction-provider-select'), {
        target: { value: 'local' },
      })
    })

    await waitFor(() => screen.getByTestId('local-preset'))
    act(() => {
      fireEvent.change(screen.getByTestId('local-preset'), { target: { value: 'ollama' } })
    })
    act(() => {
      fireEvent.change(screen.getByTestId('local-model'), { target: { value: 'llama3.1' } })
    })
    act(() => {
      fireEvent.click(screen.getByTestId('save-local'))
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return json.includes('"extractionProvider":"local"') && json.includes('"preset":"ollama"')
        }),
      ).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Phase 3.4: import-only cloud ASR providers (OpenAI / Mistral / Azure Speech)
// ---------------------------------------------------------------------------

describe('SettingsScreen — import-only cloud ASR (Phase 3.4)', () => {
  beforeEach(() => {
    setup()
  })

  it('offers OpenAI, Mistral and Azure as ASR options', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))
    const select = screen.getByTestId('asr-provider-select')
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value)
    expect(values).toContain('openai-audio')
    expect(values).toContain('mistral-voxtral')
    expect(values).toContain('azure-speech')
  })

  it('shows the audio config when OpenAI audio is selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))

    act(() => {
      fireEvent.change(screen.getByTestId('asr-provider-select'), {
        target: { value: 'openai-audio' },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('audio-model')).toBeDefined()
      expect(screen.getByTestId('audio-key-input')).toBeDefined()
    })
    // The import-only notice is gone now that live streaming is supported.
    expect(screen.queryByTestId('asr-import-only-notice')).toBeNull()
  })

  it('does not persist on selection alone — Save is required', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))

    act(() => {
      fireEvent.change(screen.getByTestId('asr-provider-select'), {
        target: { value: 'openai-audio' },
      })
    })
    await waitFor(() => screen.getByTestId('save-audio-config'))

    // Revealing the panel must not have written an openai-audio config yet.
    expect(
      mockApi.settingsSet.mock.calls.some((c) =>
        JSON.stringify(c[0]).includes('"asrProvider":"openai-audio"'),
      ),
    ).toBe(false)
  })

  it('persists asrProvider openai-audio with the default model when saved', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))

    act(() => {
      fireEvent.change(screen.getByTestId('asr-provider-select'), {
        target: { value: 'openai-audio' },
      })
    })
    await waitFor(() => screen.getByTestId('save-audio-config'))
    act(() => {
      fireEvent.click(screen.getByTestId('save-audio-config'))
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return (
            json.includes('"asrProvider":"openai-audio"') &&
            json.includes('"model":"gpt-4o-mini-transcribe"')
          )
        }),
      ).toBe(true)
    })
  })

  it('saves the audio key via secret:set under the vendor keyRef', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))
    act(() => {
      fireEvent.change(screen.getByTestId('asr-provider-select'), {
        target: { value: 'openai-audio' },
      })
    })
    await waitFor(() => screen.getByTestId('audio-key-input'))

    fireEvent.change(screen.getByTestId('audio-key-input'), { target: { value: 'sk-audio-123' } })
    act(() => {
      fireEvent.click(screen.getByTestId('save-audio-key'))
    })

    await waitFor(() => {
      expect(mockApi.secretSet).toHaveBeenCalledWith({ key: 'openai', value: 'sk-audio-123' })
    })
  })

  it('shows the Azure Speech endpoint/deployment fields when selected', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))
    act(() => {
      fireEvent.change(screen.getByTestId('asr-provider-select'), {
        target: { value: 'azure-speech' },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('azure-speech-endpoint')).toBeDefined()
      expect(screen.getByTestId('azure-speech-deployment')).toBeDefined()
      expect(screen.getByTestId('azure-speech-api-version')).toBeDefined()
    })
  })

  it('persists azure-speech on Save with a valid endpoint + deployment', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('asr-provider-select'))
    act(() => {
      fireEvent.change(screen.getByTestId('asr-provider-select'), {
        target: { value: 'azure-speech' },
      })
    })
    await waitFor(() => screen.getByTestId('azure-speech-endpoint'))

    fireEvent.change(screen.getByTestId('azure-speech-deployment'), {
      target: { value: 'whisper' },
    })
    fireEvent.change(screen.getByTestId('azure-speech-endpoint'), {
      target: { value: 'https://my-resource.openai.azure.com/' },
    })
    act(() => {
      fireEvent.click(screen.getByTestId('save-audio-config'))
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return (
            json.includes('"asrProvider":"azure-speech"') && json.includes('"deployment":"whisper"')
          )
        }),
      ).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Phase 2.2: Azure OpenAI extraction config panel
// ---------------------------------------------------------------------------

describe('SettingsScreen — Azure OpenAI extraction (Phase 2.2)', () => {
  const azureSettings: AppSettings = {
    asrProvider: 'deepgram',
    extractionProvider: 'azure-openai',
    primaryLanguage: 'nl',
    azureOpenAI: {
      endpoint: 'https://my-resource.openai.azure.com/',
      deployment: 'my-deployment',
      apiVersion: '2024-12-01-preview',
      model: 'gpt-4o-mini',
      keyRef: 'azure',
      displayName: 'Azure OpenAI',
    },
  }

  beforeEach(() => {
    setup()
  })

  it('offers Azure as a selection option in the extraction provider select', async () => {
    render(<SettingsScreen />)
    await waitFor(() => {
      const select = screen.getByTestId('extraction-provider-select')
      const azureOption = Array.from((select as HTMLSelectElement).options).find(
        (o) => o.value === 'azure',
      )
      expect(azureOption).toBeDefined()
    })
  })

  it('shows the Azure config fields (endpoint/deployment/apiVersion) when azure-openai is selected', async () => {
    setup({ settingsGet: vi.fn().mockResolvedValue(azureSettings) })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('azure-openai-endpoint')).toBeDefined()
      expect(screen.getByTestId('azure-openai-deployment')).toBeDefined()
      expect(screen.getByTestId('azure-openai-api-version')).toBeDefined()
    })
  })

  it('reveals the Azure endpoint field when Azure is picked from the select', async () => {
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('extraction-provider-select'))

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'azure' } })
    })

    await waitFor(() => {
      expect(screen.getByTestId('azure-openai-endpoint')).toBeDefined()
    })
  })

  it('persists settings as azure-openai with the deployment config when saved', async () => {
    setup({ settingsGet: vi.fn().mockResolvedValue(azureSettings) })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('azure-openai-deployment'))

    // Editing a field marks the form dirty so the save button is enabled.
    const deploymentInput = screen.getByTestId('azure-openai-deployment')
    fireEvent.change(deploymentInput, { target: { value: 'prod-deployment' } })

    const saveBtn = screen.getByTestId('save-azure-openai')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(
        mockApi.settingsSet.mock.calls.some((c) => {
          const json = JSON.stringify(c[0])
          return (
            json.includes('"extractionProvider":"azure-openai"') &&
            json.includes('"deployment":"prod-deployment"')
          )
        }),
      ).toBe(true)
    })
  })

  it('saves the Azure key via secret:set under its keyRef', async () => {
    setup({
      settingsGet: vi.fn().mockResolvedValue(azureSettings),
      secretHas: vi.fn().mockResolvedValue({ has: false }),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('azure-openai-key'))

    const input = screen.getByTestId('azure-openai-key')
    fireEvent.change(input, { target: { value: 'azure-secret-789' } })

    const saveBtn = screen.getByTestId('save-azure-key')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(mockApi.secretSet).toHaveBeenCalledWith({ key: 'azure', value: 'azure-secret-789' })
    })
  })

  it('does NOT include the Azure key value in any settings:set call', async () => {
    setup({
      settingsGet: vi.fn().mockResolvedValue(azureSettings),
      secretHas: vi.fn().mockResolvedValue({ has: false }),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('azure-openai-key'))

    const input = screen.getByTestId('azure-openai-key')
    fireEvent.change(input, { target: { value: 'AZURE_SUPER_SECRET' } })
    act(() => {
      fireEvent.click(screen.getByTestId('save-azure-key'))
    })
    await waitFor(() => {
      expect(mockApi.secretSet).toHaveBeenCalled()
    })

    for (const call of mockApi.settingsSet.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('AZURE_SUPER_SECRET')
    }
  })
})

// ---------------------------------------------------------------------------
// Phase 1.2 bugfix: key saved state and error handling
// ---------------------------------------------------------------------------

describe('SettingsScreen — custom key saved state (Phase 1.2 bugfix)', () => {
  beforeEach(() => {
    setup()
  })

  it('shows saved key status when preset key is present on mount', async () => {
    const openaiSettings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    setup({
      settingsGet: vi.fn().mockResolvedValue(openaiSettings),
      secretHas: vi.fn().mockResolvedValue({ has: true }),
    })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('custom-openai-key-status')).toBeDefined()
    })
  })

  it('shows missing key notice when preset key is absent on mount', async () => {
    const openaiSettings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    setup({
      settingsGet: vi.fn().mockResolvedValue(openaiSettings),
      secretHas: vi.fn().mockResolvedValue({ has: false }),
    })
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('custom-key-missing')).toBeDefined()
    })
  })

  it('shows saved status after saving a custom key', async () => {
    const openaiSettings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    setup({
      settingsGet: vi.fn().mockResolvedValue(openaiSettings),
      secretHas: vi.fn().mockResolvedValue({ has: false }),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('custom-openai-key'))

    const input = screen.getByTestId('custom-openai-key')
    fireEvent.change(input, { target: { value: 'sk-test-key-123' } })

    const saveBtn = screen.getByTestId('save-custom-key')
    act(() => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(mockApi.secretSet).toHaveBeenCalledWith({
        key: 'openai',
        value: 'sk-test-key-123',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('custom-openai-key-status')).toBeDefined()
    })
  })

  it('does not crash when settingsSet rejects', async () => {
    setup({
      settingsSet: vi.fn().mockRejectedValue(new Error('Zod validation failed')),
    })
    // The failed persist is logged at runtime (operator-visible); suppress and
    // assert here so the green run stays quiet.
    const console_ = captureConsole()
    render(<SettingsScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('extraction-provider-select')).toBeDefined()
    })

    const select = screen.getByTestId('extraction-provider-select')
    act(() => {
      fireEvent.change(select, { target: { value: 'openai' } })
    })

    // The form should still render after the failed persist
    await waitFor(() => {
      const saveBtn = screen.getByTestId('save-custom-openai')
      act(() => {
        fireEvent.click(saveBtn)
      })
    })

    // Screen should not be blank — the component should still be mounted
    expect(screen.getByTestId('screen-settings')).toBeDefined()
    await waitFor(() => {
      console_.expectLogged('[Settings] settingsSet failed')
    })
    console_.restore()
  })

  it('does not crash when typing a dot in the model field', async () => {
    const openaiSettings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    setup({
      settingsGet: vi.fn().mockResolvedValue(openaiSettings),
      secretHas: vi.fn().mockResolvedValue({ has: true }),
    })
    render(<SettingsScreen />)
    await waitFor(() => screen.getByTestId('custom-openai-model'))

    const modelInput = screen.getByTestId('custom-openai-model')

    // Type "gpt-5." — the dot must not crash
    fireEvent.change(modelInput, { target: { value: 'gpt-5.' } })
    expect(modelInput.value).toBe('gpt-5.')
    expect(screen.getByTestId('screen-settings')).toBeDefined()

    // Continue typing to "gpt-5.4-mini"
    fireEvent.change(modelInput, { target: { value: 'gpt-5.4-mini' } })
    expect(modelInput.value).toBe('gpt-5.4-mini')
    expect(screen.getByTestId('screen-settings')).toBeDefined()
  })
})
