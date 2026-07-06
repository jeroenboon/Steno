/**
 * @vitest-environment node
 *
 * Preload bridge tests. We mock `electron` so importing the preload captures
 * the object handed to contextBridge.exposeInMainWorld, then assert each method
 * forwards to the correct IPC channel without touching real ipcRenderer.
 *
 * Since the generic-helper refactor (audit C8/A5) the bridge also Zod-validates
 * every invoke response at the renderer boundary, so the mock must resolve a
 * schema-valid response per channel and a malformed response must reject.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { RendererApi } from '@shared/ipc'

// Schema-valid responses keyed by channel, used by the default invoke mock so
// response validation passes on the happy path.
const validResponses: Record<string, unknown> = {
  ping: { pong: true },
  'context:inferFromText': { agendaItems: [], participants: [] },
  'agendaItem:confirm': { id: 'ai-1', title: 'Begroting', topic: 'Q3', state: 'confirmed' },
  'agendaItem:editAndConfirm': { id: 'ai-1', title: 'Nieuw', topic: 'nieuw', state: 'confirmed' },
}

const invoke = vi.fn((channel: string) => Promise.resolve(validResponses[channel]))
const on = vi.fn()
const removeListener = vi.fn()
const send = vi.fn()
const exposeInMainWorld = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, send, removeListener },
}))

async function loadApi(): Promise<RendererApi> {
  await import('./index')
  return exposeInMainWorld.mock.calls[0]?.[1] as RendererApi
}

beforeEach(() => {
  invoke.mockClear()
  on.mockClear()
  removeListener.mockClear()
  send.mockClear()
  invoke.mockImplementation((channel: string) => Promise.resolve(validResponses[channel]))
})

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

describe('preload bridge — invoke response validation (audit C8)', () => {
  it('returns a schema-valid response through the typed helper', async () => {
    const api = await loadApi()

    const result = await api.agendaItemConfirm({ agendaItemId: 'ai-1' })

    // The validated, typed AgendaItem flows through unchanged.
    expect(result).toEqual({ id: 'ai-1', title: 'Begroting', topic: 'Q3', state: 'confirmed' })
  })

  it('rejects a response that violates the channel schema (not returned as-is)', async () => {
    const api = await loadApi()

    // pong must be the literal `true`; a malformed main response must be caught
    // at the boundary instead of flowing to the renderer as a lie.
    invoke.mockResolvedValueOnce({ pong: false })

    await expect(api.ping()).rejects.toThrow()
  })

  it('rejects when a response is missing required fields', async () => {
    const api = await loadApi()

    invoke.mockResolvedValueOnce({ agendaItems: [{ title: '', topic: 'x' }], participants: [] })

    await expect(
      api.inferContextFromText({ text: 'Agenda', primaryLanguage: 'nl' }),
    ).rejects.toThrow()
  })
})

describe('preload bridge — subscribe helper (audit A5)', () => {
  it('registers a listener, forwards the pushed payload, and unsubscribes', async () => {
    const api = await loadApi()

    const received: unknown[] = []
    const unsub = api.onTranscriptSpan((span) => {
      received.push(span)
    })

    // The bridge registered exactly one listener for the push channel.
    const call = on.mock.calls.find(([channel]) => channel === 'transcript:span')
    expect(call).toBeDefined()
    const listener = call?.[1] as (event: unknown, payload: unknown) => void

    // A pushed payload is forwarded to the caller's callback.
    const span = { id: 's-1', text: 'hallo', startMs: 0, endMs: 10, isFinal: true }
    listener({}, span)
    expect(received).toEqual([span])

    // The returned unsubscribe removes the exact listener from the channel.
    unsub()
    expect(removeListener).toHaveBeenCalledWith('transcript:span', listener)
  })
})
