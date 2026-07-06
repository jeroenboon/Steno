/**
 * Settings/secrets IPC handlers (audit A2b): ping, settings:get/set, egress:state,
 * secret:set/has, provider:testConnection. Owns the ProviderOps port (credential
 * probe). settingsStore + secretStorage stay top-level deps (needed here and
 * almost nowhere else); secrets are write-only over IPC (ADR 0014).
 */

import {
  PingRequestSchema,
  PingResponseSchema,
  SettingsGetRequestSchema,
  SettingsSetRequestSchema,
  SettingsSetResponseSchema,
  EgressStateGetRequestSchema,
  SecretSetRequestSchema,
  SecretSetResponseSchema,
  SecretHasRequestSchema,
  SecretHasResponseSchema,
  ProviderTestConnectionRequestSchema,
  ProviderTestConnectionResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  PingResponse,
  SettingsGetResponse,
  SettingsSetResponse,
  EgressState,
  SecretSetResponse,
  SecretHasResponse,
  ProviderTestConnectionResponse,
} from '@shared/ipc'

import type { ConnectionTestResult } from '../settings/connectionTest'
import { computeEgressState } from '../settings/egressState'
import type { SecretStorage } from '../settings/SecretStorage'
import type { SettingsStore } from '../settings/SettingsStore'

import type { Handler } from './handlerTypes'

/** Provider credential probe (provider:testConnection). */
export interface ProviderOps {
  testConnection(role: 'asr' | 'extraction'): Promise<ConnectionTestResult>
}

export interface SettingsHandlerDeps {
  /** Loaded SettingsStore instance. Must have load() already called. */
  settingsStore: SettingsStore
  /**
   * SecretStorage instance (item 0016). Handles API keys via safeStorage in
   * production, MemorySecretStorage in tests. Optional for tests that don't
   * exercise secret channels.
   */
  secretStorage?: SecretStorage
  /** Provider credential probe: provider:testConnection. */
  provider?: ProviderOps
}

export function createSettingsHandlers(
  deps: SettingsHandlerDeps,
): Partial<Record<IpcChannel, Handler>> {
  return {
    ping: (raw: unknown): PingResponse => {
      PingRequestSchema.parse(raw)
      return PingResponseSchema.parse({ pong: true })
    },
    'settings:get': (raw: unknown): SettingsGetResponse => {
      SettingsGetRequestSchema.parse(raw)
      return deps.settingsStore.current
    },
    'settings:set': async (raw: unknown): Promise<SettingsSetResponse> => {
      const settings = SettingsSetRequestSchema.parse(raw)
      await deps.settingsStore.save(settings)
      return SettingsSetResponseSchema.parse({ ok: true })
    },
    'egress:state': (raw: unknown): EgressState => {
      EgressStateGetRequestSchema.parse(raw)
      return computeEgressState(deps.settingsStore.current)
    },
    'secret:set': (raw: unknown): SecretSetResponse => {
      const req = SecretSetRequestSchema.parse(raw)
      if (deps.secretStorage === undefined) {
        throw new Error('SecretStorage is not available')
      }
      deps.secretStorage.setSecret(req.key, req.value)
      return SecretSetResponseSchema.parse({ ok: true })
    },
    'secret:has': (raw: unknown): SecretHasResponse => {
      const req = SecretHasRequestSchema.parse(raw)
      if (deps.secretStorage === undefined) {
        return SecretHasResponseSchema.parse({ has: false })
      }
      const has = deps.secretStorage.getSecret(req.key) !== null
      return SecretHasResponseSchema.parse({ has })
    },
    'provider:testConnection': async (raw: unknown): Promise<ProviderTestConnectionResponse> => {
      const req = ProviderTestConnectionRequestSchema.parse(raw)
      if (deps.provider === undefined) {
        return ProviderTestConnectionResponseSchema.parse({ ok: false, error: 'unavailable' })
      }
      const result = await deps.provider.testConnection(req.role)
      return ProviderTestConnectionResponseSchema.parse(result)
    },
  }
}
