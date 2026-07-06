/**
 * Tests for testProviderConnection (Phase 5.1).
 *
 * The "Test connection" affordance does one cheap auth/reachability round-trip
 * per provider so the user sees auth/URL errors at config time, not mid-meeting.
 * It must never log the API key.
 */

import { describe, expect, it, vi } from 'vitest'

import { testProviderConnection } from './connectionTest'
import { MemorySecretStorage } from './SecretStorage'
import type { AppSettings } from './settingsSchema'

function okResponse(status = 200): Response {
  return { ok: status >= 200 && status < 300, status } as Response
}

describe('testProviderConnection', () => {
  it('probes the models endpoint with Bearer auth for an openai-compatible extractor', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('openai', 'sk-test-123')
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'extraction',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://api.openai.com/v1/models')
    expect(call[1].method).toBe('GET')
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer sk-test-123' })
  })

  it('probes the Anthropic models endpoint with the x-api-key header', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'sk-ant-xyz')
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'extraction',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://api.anthropic.com/v1/models')
    expect(call[1].headers).toMatchObject({
      'x-api-key': 'sk-ant-xyz',
      'anthropic-version': '2023-06-01',
    })
  })

  it('probes the Azure OpenAI models endpoint with the api-key header', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('azure', 'azure-secret')
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'azure-openai',
      primaryLanguage: 'nl',
      azureOpenAI: {
        endpoint: 'https://my-res.openai.azure.com/',
        deployment: 'gpt5',
        apiVersion: '2024-12-01-preview',
        model: 'gpt-5.4-mini',
        keyRef: 'azure',
        displayName: 'Azure OpenAI',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'extraction',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe(
      'https://my-res.openai.azure.com/openai/models?api-version=2024-12-01-preview',
    )
    expect(call[1].headers).toMatchObject({ 'api-key': 'azure-secret' })
  })

  it('probes the Deepgram projects endpoint with the Token auth scheme', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('deepgram', 'dg-key')
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'asr',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://api.deepgram.com/v1/projects')
    expect(call[1].headers).toMatchObject({ Authorization: 'Token dg-key' })
  })

  it('probes the OpenAI models endpoint for openai-audio ASR', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('openai', 'sk-openai')
    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: { model: 'gpt-4o-mini-transcribe', keyRef: 'openai', displayName: 'OpenAI' },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'asr',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://api.openai.com/v1/models')
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer sk-openai' })
  })

  it('probes the Mistral models endpoint for mistral-voxtral ASR', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('mistral', 'mi-key')
    const settings: AppSettings = {
      asrProvider: 'mistral-voxtral',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      mistralVoxtral: { model: 'voxtral-mini-2507', keyRef: 'mistral', displayName: 'Mistral' },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'asr',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://api.mistral.ai/v1/models')
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer mi-key' })
  })

  it('probes the Azure models endpoint for azure-speech ASR', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('azure', 'az-speech')
    const settings: AppSettings = {
      asrProvider: 'azure-speech',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      azureSpeech: {
        endpoint: 'https://spc.openai.azure.com/',
        deployment: 'whisper',
        apiVersion: '2024-10-01-preview',
        model: 'whisper',
        keyRef: 'azure',
        displayName: 'Azure Speech',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'asr',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe(
      'https://spc.openai.azure.com/openai/models?api-version=2024-10-01-preview',
    )
    expect(call[1].headers).toMatchObject({ 'api-key': 'az-speech' })
  })

  it('probes a local endpoint unauthenticated when no key is stored (key optional)', async () => {
    const storage = new MemorySecretStorage()
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'local',
      primaryLanguage: 'nl',
      local: {
        preset: 'local-custom',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        keyRef: 'local',
        displayName: 'Lokaal',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'extraction',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: true })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('http://localhost:1234/v1/models')
    expect(call[1].headers).not.toHaveProperty('Authorization')
  })

  it('attaches Bearer auth to a local probe when a key is stored', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('local', 'llama-key')
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'local',
      primaryLanguage: 'nl',
      local: {
        preset: 'local-custom',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        keyRef: 'local',
        displayName: 'Lokaal',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    await testProviderConnection({ role: 'extraction', settings, storage, fetch: fetchMock })

    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer llama-key' })
  })

  it('returns no-key when the configured key is not stored', async () => {
    const storage = new MemorySecretStorage()
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse())

    const result = await testProviderConnection({
      role: 'asr',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: false, error: 'no-key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the HTTP status on a non-ok response', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'bad')
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const fetchMock = vi.fn().mockResolvedValue(okResponse(401))

    const result = await testProviderConnection({
      role: 'extraction',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: false, error: 'HTTP 401' })
  })

  it('degrades to a generic error on a transport failure and never leaks the key', async () => {
    const storage = new MemorySecretStorage()
    storage.setSecret('anthropic', 'super-secret-key')
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED super-secret-key'))

    const result = await testProviderConnection({
      role: 'extraction',
      settings,
      storage,
      fetch: fetchMock,
    })

    expect(result).toEqual({ ok: false, error: 'network' })
    for (const spy of [errorSpy, logSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('super-secret-key')
      }
    }
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })
})
