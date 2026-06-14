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

import { type EgressState } from './settings/egressState'
import { AppSettingsSchema } from './settings/settingsSchema'

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
// settings:get — retrieve current persisted settings
// ---------------------------------------------------------------------------

export const SettingsGetRequestSchema = z.object({})
export const SettingsGetResponseSchema = AppSettingsSchema

export type SettingsGetRequest = z.infer<typeof SettingsGetRequestSchema>
export type SettingsGetResponse = z.infer<typeof SettingsGetResponseSchema>

// ---------------------------------------------------------------------------
// settings:set — persist new settings (partial updates not supported;
// always send the full settings object)
// ---------------------------------------------------------------------------

export const SettingsSetRequestSchema = AppSettingsSchema
export const SettingsSetResponseSchema = z.object({ ok: z.literal(true) })

export type SettingsSetRequest = z.infer<typeof SettingsSetRequestSchema>
export type SettingsSetResponse = z.infer<typeof SettingsSetResponseSchema>

// ---------------------------------------------------------------------------
// egress:state — derive the current egress state from persisted settings
// ---------------------------------------------------------------------------

export const EgressStateGetRequestSchema = z.object({})

/**
 * EgressState is serialised over IPC as a plain object. We re-validate it
 * on the renderer side via this schema (principle #8 — validate at every
 * boundary).
 */
export const EgressStateGetResponseSchema = z.object({
  audio: z.union([z.literal('local'), z.string().startsWith('cloud:')]),
  notes: z.string().startsWith('cloud:'),
})

export type EgressStateGetRequest = z.infer<typeof EgressStateGetRequestSchema>
// Re-export EgressState as the IPC response type so the renderer can use it
export type { EgressState }

// ---------------------------------------------------------------------------
// Channel registry — exhaustive union of all channel names
// ---------------------------------------------------------------------------

export type IpcChannel = 'ping' | 'settings:get' | 'settings:set' | 'egress:state'

// ---------------------------------------------------------------------------
// Typed preload API surface exposed to the renderer via contextBridge
// ---------------------------------------------------------------------------

export interface RendererApi {
  /** Send a ping to main; resolves with { pong: true }. */
  ping: () => Promise<PingResponse>
  /** Retrieve the current persisted settings. */
  settingsGet: () => Promise<SettingsGetResponse>
  /** Persist new settings. Replaces the full settings object. */
  settingsSet: (settings: SettingsSetRequest) => Promise<SettingsSetResponse>
  /** Get the current egress state derived from settings. */
  egressState: () => Promise<EgressState>
}
