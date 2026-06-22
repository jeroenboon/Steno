/**
 * onValidated — subscribe to a main→renderer push channel with Zod validation.
 *
 * The renderer subscribes to several one-way push channels (transcript spans,
 * proposed items, nudges, running summary). Each payload crosses the IPC
 * boundary and must be validated before it enters the store (rule #8). That made
 * the same shape repeat at every call site:
 *
 *   const unsub = window.api.onX((raw) => {
 *     const r = SomeSchema.safeParse(raw)
 *     if (r.success) doThing(r.data)
 *   })
 *
 * Shallow duplication, and easy to forget the `.success` guard on a new channel.
 * onValidated wraps that: it runs safeParse and calls `handler` only on success,
 * dropping invalid payloads silently (the existing behaviour). The push-channel
 * `subscribe` function and the returned UnsubscribeFn are passed straight
 * through, so teardown is unchanged.
 */

import { z } from 'zod'

import type { UnsubscribeFn } from '@shared/ipc'

export function onValidated<T>(
  subscribe: (cb: (raw: unknown) => void) => UnsubscribeFn,
  schema: z.ZodType<T>,
  handler: (data: T) => void,
): UnsubscribeFn {
  return subscribe((raw) => {
    const result = schema.safeParse(raw)
    if (result.success) {
      handler(result.data)
    }
  })
}
