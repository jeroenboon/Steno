/**
 * Preload bridge helpers — the thin, typed plumbing behind window.api.
 *
 * Two shapes repeated ~35 times each in the old preload:
 *
 *   invoke:    (req) => ipcRenderer.invoke('channel', req) as Promise<Resp>
 *   subscribe: on('channel', l); return () => removeListener('channel', l)
 *
 * The `as Promise<Resp>` was a cast, not a validation — a wrong response from
 * main flowed to the renderer as a typed lie (audit C8). `invoke()` here looks
 * the channel's response schema up in the single-source-of-truth registry
 * (`ipcChannelSchemas` in @shared/ipc) and Zod-parses the response before
 * returning, so a malformed response throws at the boundary (rule #7). The
 * return type is inferred per-channel from the registry, so every window.api
 * method keeps its exact TypeScript type with zero casts at the call site.
 *
 * The request is forwarded as-is (main re-validates it in the ipc-registry, and
 * parsing here would apply schema defaults and change the wire payload). Push
 * channels are validated renderer-side by `onValidated` (src/renderer/.../
 * onValidated.ts); `subscribe()` only owns the listener/unsubscribe plumbing.
 */

import { ipcRenderer } from 'electron'

import { ipcChannelSchemas } from '@shared/ipc'
import type { IpcChannel, IpcRequest, IpcResponse, UnsubscribeFn } from '@shared/ipc'

/**
 * Invoke a request/response IPC channel and Zod-validate the response.
 *
 * @throws if main returns a payload that violates the channel's response schema.
 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  req: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const raw: unknown = await ipcRenderer.invoke(channel, req)
  const { response } = ipcChannelSchemas[channel]
  return response.parse(raw) as IpcResponse<C>
}

/**
 * Subscribe to a main→renderer push channel. Returns an UnsubscribeFn that
 * removes the exact listener. Payload validation lives in the renderer's
 * onValidated; this helper only collapses the listener/teardown boilerplate.
 */
// `T` is load-bearing: it lets each window.api.onX keep its exact payload
// callback type. Inlining to `unknown` breaks assignability of the caller's
// typed cb under strictFunctionTypes (function params are contravariant), so the
// no-unnecessary-type-parameters rule is a false positive here.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function subscribe<T>(channel: string, cb: (payload: T) => void): UnsubscribeFn {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    cb(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
