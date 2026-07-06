/**
 * Tests for callApi — the thin renderer→main IPC call wrapper.
 *
 * Behaviour under test:
 *  - resolves true and forwards the awaited result when fn() succeeds
 *  - resolves false and logs `[label] failed:` when fn() rejects
 *  - never rethrows (callers stay fire-and-forget)
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

import { callApi } from './callApi'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('callApi', () => {
  it('returns true when the call succeeds', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true })
    const ok = await callApi('Test action', fn)
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('returns false and logs [label] failed on rejection, without rethrowing', async () => {
    const err = new Error('boom')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await callApi('Test action', () => Promise.reject(err))
    expect(ok).toBe(false)
    expect(spy).toHaveBeenCalledWith('[Test action] failed:', err)
  })
})
