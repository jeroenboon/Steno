/**
 * Settings / secrets / provider IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Channels: ping, settings:get, settings:set, egress:state, secret:set,
 * secret:has, provider:testConnection.
 */

import { z } from 'zod'

import { type EgressState } from '../settings/egressState'
import { AppSettingsSchema } from '../settings/settingsSchema'

import type { IpcChannelSchema } from './common'

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
// secret:set — write an API key into safeStorage (item 0016)
//
// The renderer sends the key value exactly once during the user's key-entry
// flow. Main encrypts it via safeStorage and stores it; the value is never
// sent back to the renderer. There is deliberately NO secret:get channel.
// ---------------------------------------------------------------------------

export const SecretSetRequestSchema = z.object({
  /** Stable key name used to look up the secret (e.g. 'deepgram', 'anthropic'). */
  key: z.string().min(1),
  /** The raw API key value — encrypted by main, never stored in settings JSON. */
  value: z.string().min(1),
})

export const SecretSetResponseSchema = z.object({ ok: z.literal(true) })

export type SecretSetRequest = z.infer<typeof SecretSetRequestSchema>
export type SecretSetResponse = z.infer<typeof SecretSetResponseSchema>

// ---------------------------------------------------------------------------
// secret:has — check whether a key is present in safeStorage (item 0016)
//
// Returns a boolean presence flag. Never returns the key value.
// ---------------------------------------------------------------------------

export const SecretHasRequestSchema = z.object({
  key: z.string().min(1),
})

export const SecretHasResponseSchema = z.object({
  /** true if a secret is stored for this key, false otherwise. */
  has: z.boolean(),
})

export type SecretHasRequest = z.infer<typeof SecretHasRequestSchema>
export type SecretHasResponse = z.infer<typeof SecretHasResponseSchema>

// ---------------------------------------------------------------------------
// provider:testConnection — probe the configured provider's credentials (5.1)
//
// One cheap auth/reachability round-trip (models/projects listing) so the user
// sees auth/URL errors at config time. Never returns or logs the key. The error
// string is a short code (e.g. 'HTTP 401', 'no-key', 'network').
// ---------------------------------------------------------------------------

export const ProviderTestConnectionRequestSchema = z.object({
  role: z.enum(['asr', 'extraction']),
})

export const ProviderTestConnectionResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

export type ProviderTestConnectionRequest = z.infer<typeof ProviderTestConnectionRequestSchema>
export type ProviderTestConnectionResponse = z.infer<typeof ProviderTestConnectionResponseSchema>

// ---------------------------------------------------------------------------
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type SettingsChannel =
  | 'ping'
  | 'settings:get'
  | 'settings:set'
  | 'egress:state'
  | 'secret:set'
  | 'secret:has'
  | 'provider:testConnection'

export const settingsChannelSchemas = {
  ping: { request: PingRequestSchema, response: PingResponseSchema },
  'settings:get': { request: SettingsGetRequestSchema, response: SettingsGetResponseSchema },
  'settings:set': { request: SettingsSetRequestSchema, response: SettingsSetResponseSchema },
  'egress:state': { request: EgressStateGetRequestSchema, response: EgressStateGetResponseSchema },
  'secret:set': { request: SecretSetRequestSchema, response: SecretSetResponseSchema },
  'secret:has': { request: SecretHasRequestSchema, response: SecretHasResponseSchema },
  'provider:testConnection': {
    request: ProviderTestConnectionRequestSchema,
    response: ProviderTestConnectionResponseSchema,
  },
} satisfies Record<SettingsChannel, IpcChannelSchema>

export interface SettingsApi {
  /** Send a ping to main; resolves with { pong: true }. */
  ping: () => Promise<PingResponse>
  /** Retrieve the current persisted settings. */
  settingsGet: () => Promise<SettingsGetResponse>
  /** Persist new settings. Replaces the full settings object. */
  settingsSet: (settings: SettingsSetRequest) => Promise<SettingsSetResponse>
  /** Get the current egress state derived from settings. */
  egressState: () => Promise<EgressState>
  /**
   * Write an API key into safeStorage. The key value is transmitted to main
   * exactly once during entry and is never returned to the renderer.
   * (item 0016)
   */
  secretSet: (req: SecretSetRequest) => Promise<SecretSetResponse>
  /**
   * Check whether an API key is stored for the given name.
   * Returns a boolean presence flag — never the key value.
   * (item 0016)
   */
  secretHas: (req: SecretHasRequest) => Promise<SecretHasResponse>
  /**
   * Probe the configured provider's credentials with one cheap round-trip (5.1).
   * Surfaces auth/URL errors at config time. Never returns or logs the key.
   */
  providerTestConnection: (
    req: ProviderTestConnectionRequest,
  ) => Promise<ProviderTestConnectionResponse>
}
