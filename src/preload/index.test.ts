/**
 * @vitest-environment node
 *
 * Preload bridge tests. We mock `electron` so importing the preload captures
 * the object handed to contextBridge.exposeInMainWorld, then assert each method
 * forwards to the correct IPC channel without touching real ipcRenderer.
 */
import { describe, it, expect, vi } from 'vitest'

import type { RendererApi } from '@shared/ipc'

const invoke = vi.fn().mockResolvedValue({ agendaItems: [], participants: [] })
const exposeInMainWorld = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

async function loadApi(): Promise<RendererApi> {
  await import('./index')
  return exposeInMainWorld.mock.calls[0]?.[1] as RendererApi
}

describe('preload bridge — inferContextFromText (ADR 0029)', () => {
  it('forwards to the context:inferFromText channel', async () => {
    const api = await loadApi()

    const req = { text: 'Agenda: begroting', primaryLanguage: 'nl' }
    await api.inferContextFromText(req)

    expect(invoke).toHaveBeenCalledWith('context:inferFromText', req)
  })
})
