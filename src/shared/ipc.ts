/**
 * IPC contract for main ↔ renderer communication.
 *
 * Channel names, request types, and response types are all defined here.
 * The renderer never touches ipcRenderer directly — everything goes through
 * the typed preload bridge (window.api).
 *
 * Zod schemas serve as the single source of truth; TypeScript types are
 * derived from them via z.infer.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// ping — smoke-test channel proving the bridge is alive
// ---------------------------------------------------------------------------

export const PingRequestSchema = z.object({})

export const PingResponseSchema = z.object({
  pong: z.literal(true),
})

export type PingRequest = z.infer<typeof PingRequestSchema>
export type PingResponse = z.infer<typeof PingResponseSchema>

// ---------------------------------------------------------------------------
// Channel registry — exhaustive union of all channel names
// ---------------------------------------------------------------------------

export type IpcChannel = 'ping'

// ---------------------------------------------------------------------------
// Typed preload API surface exposed to the renderer via contextBridge
// ---------------------------------------------------------------------------

export interface RendererApi {
  /** Send a ping to main; resolves with { pong: true }. */
  ping: () => Promise<PingResponse>
}
