/**
 * @vitest-environment node
 *
 * Preload bridge tests. We mock `electron` so importing the preload captures
 * the object handed to contextBridge.exposeInMainWorld, then assert each method
 * forwards to the correct IPC channel without touching real ipcRenderer.
 *
 * The generic-helper refactor (audit A5) collapses the per-method repetition.
 * The helper forwards each response typed but UNVALIDATED: the preload runs
 * sandboxed (sandbox: true, ADR 0005) and cannot pull zod/the schema graph at
 * runtime without failing to load, so response validation must not live here.
 * The mock therefore just resolves a representative response per channel for the
 * forwarding assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { RendererApi } from '@shared/ipc'

// Representative responses keyed by channel for the forwarding assertions.
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

describe('preload bridge — invoke forwards the typed response (audit A5)', () => {
  it('returns the response from main through the typed helper unchanged', async () => {
    const api = await loadApi()

    const result = await api.agendaItemConfirm({ agendaItemId: 'ai-1' })

    // The typed AgendaItem flows through as-is (no runtime validation here — see
    // the file header: the sandboxed preload carries no zod).
    expect(result).toEqual({ id: 'ai-1', title: 'Begroting', topic: 'Q3', state: 'confirmed' })
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

  it('registers onAsrTerminal on the asr:terminal channel and unsubscribes (audit C4)', async () => {
    const api = await loadApi()

    const received: unknown[] = []
    const unsub = api.onAsrTerminal((payload) => {
      received.push(payload)
    })

    const call = on.mock.calls.find(([channel]) => channel === 'asr:terminal')
    expect(call).toBeDefined()
    const listener = call?.[1] as (event: unknown, payload: unknown) => void

    // Reason-only payload is forwarded to the caller's callback.
    const payload = { reason: 'auth' }
    listener({}, payload)
    expect(received).toEqual([payload])

    unsub()
    expect(removeListener).toHaveBeenCalledWith('asr:terminal', listener)
  })

  it('registers onExtractionTerminal on the extraction:terminal channel and unsubscribes (ADR 0042)', async () => {
    const api = await loadApi()

    const received: unknown[] = []
    const unsub = api.onExtractionTerminal((payload) => {
      received.push(payload)
    })

    const call = on.mock.calls.find(([channel]) => channel === 'extraction:terminal')
    expect(call).toBeDefined()
    const listener = call?.[1] as (event: unknown, payload: unknown) => void

    const payload = { reason: 'output-truncated' }
    listener({}, payload)
    expect(received).toEqual([payload])

    unsub()
    expect(removeListener).toHaveBeenCalledWith('extraction:terminal', listener)
  })
})
