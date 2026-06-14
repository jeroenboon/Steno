import { describe, expect, it } from 'vitest'

import type { IpcChannel } from '@shared/ipc'

import { createIpcRegistry } from './ipc-registry'
import { DEFAULT_SETTINGS, type AppSettings } from './settings/settingsSchema'
import type { SettingsStore } from './settings/SettingsStore'

// ---------------------------------------------------------------------------
// Minimal SettingsStore stub for tests
// ---------------------------------------------------------------------------

function makeStubSettingsStore(settings?: AppSettings): SettingsStore {
  let _current: AppSettings = settings ?? DEFAULT_SETTINGS
  return {
    load: () => Promise.resolve(_current),
    save: (s: AppSettings) => {
      _current = s
      return Promise.resolve()
    },
    get current() {
      return _current
    },
  } as unknown as SettingsStore
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createIpcRegistry', () => {
  it('dispatches ping and returns { pong: true }', async () => {
    const registry = createIpcRegistry({ settingsStore: makeStubSettingsStore() })
    const result = await registry.dispatch('ping', {})
    expect(result).toEqual({ pong: true })
  })

  it('rejects an unknown channel with a typed error', async () => {
    const registry = createIpcRegistry({ settingsStore: makeStubSettingsStore() })
    const unknownChannel = 'unknown-channel' as unknown as IpcChannel
    await expect(registry.dispatch(unknownChannel, {})).rejects.toThrow(/unknown channel/i)
  })

  it('rejects a ping call with an invalid payload (Zod validation)', async () => {
    const registry = createIpcRegistry({ settingsStore: makeStubSettingsStore() })
    await expect(registry.dispatch('ping', 'bad-payload')).rejects.toThrow()
  })

  it('settings:get returns current settings from the store', async () => {
    const store = makeStubSettingsStore({ ...DEFAULT_SETTINGS, primaryLanguage: 'en' })
    const registry = createIpcRegistry({ settingsStore: store })
    const result = await registry.dispatch('settings:get', {})
    expect(result).toMatchObject({ primaryLanguage: 'en' })
  })

  it('settings:set saves settings and returns { ok: true }', async () => {
    const store = makeStubSettingsStore()
    const registry = createIpcRegistry({ settingsStore: store })
    const newSettings: AppSettings = { ...DEFAULT_SETTINGS, primaryLanguage: 'de' }
    const result = await registry.dispatch('settings:set', newSettings)
    expect(result).toEqual({ ok: true })
    expect(store.current.primaryLanguage).toBe('de')
  })

  it('settings:set rejects invalid settings payload', async () => {
    const store = makeStubSettingsStore()
    const registry = createIpcRegistry({ settingsStore: store })
    await expect(
      registry.dispatch('settings:set', { asrProvider: 'unknown-asr' }),
    ).rejects.toThrow()
  })

  it('egress:state returns computed egress state from current settings', async () => {
    const store = makeStubSettingsStore({
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    })
    const registry = createIpcRegistry({ settingsStore: store })
    const result = await registry.dispatch('egress:state', {})
    expect(result).toEqual({
      audio: 'cloud:Deepgram',
      notes: 'cloud:Anthropic',
    })
  })
})
