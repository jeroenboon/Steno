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

describe('preload bridge — live agenda grooming (ADR 0029)', () => {
  it('forwards agendaItemConfirm to the agendaItem:confirm channel', async () => {
    const api = await loadApi()

    await api.agendaItemConfirm({ agendaItemId: 'ai-1' })

    expect(invoke).toHaveBeenCalledWith('agendaItem:confirm', { agendaItemId: 'ai-1' })
  })

  it('forwards agendaItemEditAndConfirm to the agendaItem:editAndConfirm channel', async () => {
    const api = await loadApi()

    const req = { agendaItemId: 'ai-1', title: 'Nieuw', topic: 'nieuw' }
    await api.agendaItemEditAndConfirm(req)

    expect(invoke).toHaveBeenCalledWith('agendaItem:editAndConfirm', req)
  })
})
