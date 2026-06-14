/**
 * Pure IPC handler registry for the main process.
 *
 * createIpcRegistry() returns a registry with a dispatch() method. All IPC
 * payloads are validated with Zod before reaching the handler. Unknown channels
 * are rejected at runtime, not silently swallowed.
 *
 * This is a pure function (no Electron imports) so it can be unit-tested
 * without launching Electron.
 */

import type { IpcChannel, PingResponse } from '@shared/ipc'
import { PingRequestSchema, PingResponseSchema } from '@shared/ipc'

// A handler takes an unknown payload, validates it, and returns the result.
type Handler = (raw: unknown) => unknown

// The dispatch signature is typed over the known channel union so callers get
// type-safe autocomplete, while the runtime guard catches anything that slips
// through (e.g. from untyped IPC events coming off the wire).
export interface IpcRegistry {
  dispatch: (channel: IpcChannel, payload: unknown) => Promise<unknown>
}

function handlePing(raw: unknown): PingResponse {
  PingRequestSchema.parse(raw)
  return PingResponseSchema.parse({ pong: true })
}

// Typed as a partial map so that unknown channels yield undefined at runtime.
const HANDLERS: Partial<Record<IpcChannel, Handler>> = {
  ping: handlePing,
}

export function createIpcRegistry(): IpcRegistry {
  return {
    dispatch(channel, payload) {
      const handler = HANDLERS[channel]
      if (handler === undefined) {
        return Promise.reject(new Error(`IPC: unknown channel "${channel}"`))
      }
      try {
        return Promise.resolve(handler(payload))
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)))
      }
    },
  }
}
