/**
 * Preload bridge helpers — the thin, typed plumbing behind window.api.
 *
 * Two shapes repeated ~35 times each in the old preload:
 *
 *   invoke:    (req) => ipcRenderer.invoke('channel', req) as Promise<Resp>
 *   subscribe: on('channel', l); return () => removeListener('channel', l)
 *
 * `invoke()` collapses that repetition into one generic helper whose return
 * type is inferred per-channel from the IPC contract, so every window.api method
 * keeps its exact TypeScript type with zero casts at the call site (audit A5).
 *
 * IMPORTANT — no runtime Zod here. This preload runs SANDBOXED (sandbox: true,
 * the ADR 0005 security baseline). A sandboxed preload cannot require Node
 * modules, so importing `zod` (or anything that pulls the schema graph, e.g.
 * `ipcChannelSchemas`) makes the whole preload fail to load with "module not
 * found: zod" — `contextBridge.exposeInMainWorld` never runs, window.api is
 * undefined, and the renderer blanks. So `invoke()` forwards the response typed
 * but UNVALIDATED. Response validation, if wanted, belongs on the renderer side
 * (like push payloads via onValidated), never in the sandboxed preload. Main is
 * trusted code, so this is only the "rule-consistency" gap the audit (C8) noted,
 * not a security one. Only type-only imports from @shared/ipc are allowed here
 * (they are erased at build time and pull no runtime dependency).
 */

import { ipcRenderer } from 'electron'

import type { IpcChannel, IpcRequest, IpcResponse, UnsubscribeFn } from '@shared/ipc'

/**
 * Invoke a request/response IPC channel. The response is typed per-channel but
 * forwarded as-is (see the file header: no runtime validation in the sandboxed
 * preload).
 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  req: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  return (await ipcRenderer.invoke(channel, req)) as IpcResponse<C>
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
