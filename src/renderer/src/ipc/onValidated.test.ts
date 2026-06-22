/**
 * Tests for onValidated (architecture task 4).
 *
 * The helper wraps a push-channel subscription: it runs Zod safeParse and calls
 * the handler only on a valid payload, dropping invalid ones silently. The
 * subscribe function and its UnsubscribeFn pass straight through.
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

import { onValidated } from './onValidated'

const Schema = z.object({ value: z.number() })

/** A fake push channel: capture the callback so the test can emit payloads. */
function makeChannel() {
  let captured: ((raw: unknown) => void) | undefined
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((cb: (raw: unknown) => void) => {
    captured = cb
    return unsubscribe
  })
  return {
    subscribe,
    unsubscribe,
    emit: (raw: unknown) => captured?.(raw),
  }
}

describe('onValidated', () => {
  it('calls the handler with parsed data on a valid payload', () => {
    const { subscribe, emit } = makeChannel()
    const handler = vi.fn()

    onValidated(subscribe, Schema, handler)
    emit({ value: 42 })

    expect(handler).toHaveBeenCalledWith({ value: 42 })
  })

  it('drops an invalid payload and never calls the handler', () => {
    const { subscribe, emit } = makeChannel()
    const handler = vi.fn()

    onValidated(subscribe, Schema, handler)
    emit({ value: 'not a number' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('returns the channel unsubscribe, which still works after an invalid payload', () => {
    const { subscribe, unsubscribe, emit } = makeChannel()
    const handler = vi.fn()

    const unsub = onValidated(subscribe, Schema, handler)
    emit({ nope: true })
    unsub()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
