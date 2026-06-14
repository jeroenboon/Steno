import { describe, expect, it } from 'vitest'

import type { IpcChannel } from '@shared/ipc'

import { createIpcRegistry } from './ipc-registry'

// Slice 2 — pure handler registry: dispatch, unknown-channel rejection

describe('createIpcRegistry', () => {
  it('dispatches a known channel and returns its result', async () => {
    const registry = createIpcRegistry()
    const result = await registry.dispatch('ping', {})
    expect(result).toEqual({ pong: true })
  })

  it('rejects an unknown channel with a typed error', async () => {
    const registry = createIpcRegistry()
    // Cast via unknown to bypass the TS channel union so we can test the runtime guard
    const unknownChannel = 'unknown-channel' as unknown as IpcChannel
    await expect(registry.dispatch(unknownChannel, {})).rejects.toThrow(/unknown channel/i)
  })

  it('rejects a ping call with an invalid payload (Zod validation)', async () => {
    const registry = createIpcRegistry()
    // Pass something that is not a valid PingRequest (non-object)
    await expect(registry.dispatch('ping', 'bad-payload')).rejects.toThrow()
  })
})
