/**
 * Tests for useSecretKeyField — the per-secret key-entry lifecycle hook.
 *
 * SettingsScreen used to carry five identical copies of this state quartet
 * (entry / saveState / editing / present) plus an identical save handler, one
 * per vendor key. The hook owns that lifecycle; these tests pin its behaviour
 * through renderHook with a mocked window.api.secretSet — no real IPC.
 */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSecretKeyField } from './useSecretKeyField'

const secretSet = vi.fn<(arg: { key: string; value: string }) => Promise<void>>()

Object.assign(window, { api: { secretSet } })

beforeEach(() => {
  vi.clearAllMocks()
  secretSet.mockResolvedValue(undefined)
})

describe('useSecretKeyField', () => {
  it('starts empty, idle, not editing, not present', () => {
    const { result } = renderHook(() => useSecretKeyField())

    expect(result.current.value).toBe('')
    expect(result.current.saveState).toBe('idle')
    expect(result.current.editing).toBe(false)
    expect(result.current.present).toBe(false)
  })

  it('change() updates the value', () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('sk-123')
    })

    expect(result.current.value).toBe('sk-123')
  })

  it('save() stores the key under the given keyRef, then clears the entry and marks it present', async () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('sk-123')
    })
    await act(async () => {
      await result.current.save('deepgram')
    })

    expect(secretSet).toHaveBeenCalledWith({ key: 'deepgram', value: 'sk-123' })
    expect(result.current.present).toBe(true)
    expect(result.current.value).toBe('')
    expect(result.current.saveState).toBe('saved')
    expect(result.current.editing).toBe(false)
  })

  it('save() is a no-op for a blank entry (never calls secretSet)', async () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('   ')
    })
    await act(async () => {
      await result.current.save('deepgram')
    })

    expect(secretSet).not.toHaveBeenCalled()
    expect(result.current.saveState).toBe('idle')
  })

  it('save() sets an error state when secretSet rejects, leaving the entry intact', async () => {
    secretSet.mockRejectedValueOnce(new Error('DPAPI down'))
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('sk-123')
    })
    await act(async () => {
      await result.current.save('deepgram')
    })

    expect(result.current.saveState).toBe('error')
    expect(result.current.present).toBe(false)
    expect(result.current.value).toBe('sk-123')
  })

  it('change() after a successful save resets the saved badge to idle', async () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('sk-123')
    })
    await act(async () => {
      await result.current.save('deepgram')
    })
    expect(result.current.saveState).toBe('saved')

    act(() => {
      result.current.change('sk-4')
    })

    expect(result.current.saveState).toBe('idle')
  })

  it('beginReplace() reveals the input; cancel() hides it and clears the entry', () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('typed')
      result.current.beginReplace()
    })
    expect(result.current.editing).toBe(true)

    act(() => {
      result.current.cancel()
    })
    expect(result.current.editing).toBe(false)
    expect(result.current.value).toBe('')
  })

  it('setPresent() seeds presence from the mount-time probe', () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.setPresent(true)
    })

    expect(result.current.present).toBe(true)
  })

  it('resetSaveState() returns the save state to idle', async () => {
    const { result } = renderHook(() => useSecretKeyField())

    act(() => {
      result.current.change('sk-123')
    })
    await act(async () => {
      await result.current.save('deepgram')
    })
    expect(result.current.saveState).toBe('saved')

    act(() => {
      result.current.resetSaveState()
    })

    expect(result.current.saveState).toBe('idle')
  })
})
