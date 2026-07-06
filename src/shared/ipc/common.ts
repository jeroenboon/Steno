/**
 * Shared primitives for the per-domain IPC contract modules.
 *
 * These modules are composed by the `@shared/ipc` barrel (`src/shared/ipc.ts`),
 * which assembles the `IpcChannel` union, the `ipcChannelSchemas` registry, and
 * the `RendererApi` interface from the per-domain fragments. Importers use the
 * barrel; the fragments exist only to keep the contract navigable (audit A4).
 */

import { z } from 'zod'

/** Cleanup function returned by an onX subscription; call to remove the listener. */
export type UnsubscribeFn = () => void

/**
 * Shape of one entry in a per-domain channel-schema slice. Each domain declares
 * its slice `satisfies Record<ItsChannel, IpcChannelSchema>` for a local drift
 * guard; the barrel composes them `satisfies Record<IpcChannel, IpcChannelSchema>`
 * for the global one.
 */
export interface IpcChannelSchema {
  request: z.ZodType
  response: z.ZodType
}
