/**
 * Pure IPC handler registry for the main process.
 *
 * createIpcRegistry() returns a registry with a dispatch() method. All IPC
 * payloads are validated with Zod before reaching the handler. Unknown channels
 * are rejected at runtime, not silently swallowed.
 *
 * This is a pure function (no Electron imports) so it can be unit-tested
 * without launching Electron.
 *
 * ## Handler injection (added in item 0012)
 *
 * Handlers that depend on stateful services (SettingsStore, SecretStorage) are
 * injected at registry creation time via IpcRegistryDependencies. This keeps
 * the registry itself pure and testable while allowing the real services to be
 * wired in src/main/index.ts.
 */

import { randomUUID } from 'crypto'

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
  MeetingCreateRequestSchema,
  MeetingCreateResponseSchema,
  AgendaItemAddRequestSchema,
  AgendaItemAddResponseSchema,
  AgendaItemRemoveRequestSchema,
  AgendaItemRemoveResponseSchema,
  ParticipantAddRequestSchema,
  ParticipantAddResponseSchema,
  ParticipantRemoveRequestSchema,
  ParticipantRemoveResponseSchema,
  MeetingStartRequestSchema,
  MeetingStartResponseSchema,
  AudioStartRequestSchema,
  AudioStartResponseSchema,
  AudioStopRequestSchema,
  AudioStopResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  PingResponse,
  SettingsGetResponse,
  SettingsSetResponse,
  EgressState,
  SecretSetResponse,
  SecretHasResponse,
  MeetingCreateResponse,
  AgendaItemAddResponse,
  AgendaItemRemoveResponse,
  ParticipantAddResponse,
  ParticipantRemoveResponse,
  MeetingStartResponse,
  AudioStartResponse,
  AudioStopResponse,
} from '@shared/ipc'
import type { Clock } from '@shared/providers'

import type { AudioCaptureBridge } from './audio/AudioCaptureBridge'
import { computeEgressState } from './settings/egressState'
import type { SecretStorage } from './settings/SecretStorage'
import type { SettingsStore } from './settings/SettingsStore'

// A handler takes an unknown payload, validates it, and returns the result.
// The return is unknown at the type level; runtime callers use Promise.resolve() on it.
type Handler = (raw: unknown) => unknown

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface IpcRegistryDependencies {
  /** Loaded SettingsStore instance. Must have load() already called. */
  settingsStore: SettingsStore
  /**
   * SecretStorage instance (item 0016).
   * Handles API keys via safeStorage in production, MemorySecretStorage in tests.
   * Optional for backwards compat with tests that don't exercise secret channels.
   */
  secretStorage?: SecretStorage
  /** Database instance (optional, for future persistence). */
  db?: unknown
  /** Clock for generating timestamps. */
  clock?: Clock
  /**
   * Audio capture bridge (item 0015).
   * Optional: when absent, audio:start / audio:stop return ok but are no-ops.
   * Injected in production after the window is created.
   */
  audioBridge?: AudioCaptureBridge
}

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

// The dispatch signature is typed over the known channel union so callers get
// type-safe autocomplete, while the runtime guard catches anything that slips
// through (e.g. from untyped IPC events coming off the wire).
export interface IpcRegistry {
  dispatch: (channel: IpcChannel, payload: unknown) => Promise<unknown>
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handlePing(raw: unknown): PingResponse {
  PingRequestSchema.parse(raw)
  return PingResponseSchema.parse({ pong: true })
}

function makeHandleSettingsGet(deps: IpcRegistryDependencies) {
  return function handleSettingsGet(raw: unknown): SettingsGetResponse {
    SettingsGetRequestSchema.parse(raw)
    return deps.settingsStore.current
  }
}

function makeHandleSettingsSet(deps: IpcRegistryDependencies) {
  return async function handleSettingsSet(raw: unknown): Promise<SettingsSetResponse> {
    const settings = SettingsSetRequestSchema.parse(raw)
    await deps.settingsStore.save(settings)
    return SettingsSetResponseSchema.parse({ ok: true })
  }
}

function makeHandleEgressState(deps: IpcRegistryDependencies) {
  return function handleEgressState(raw: unknown): EgressState {
    EgressStateGetRequestSchema.parse(raw)
    return computeEgressState(deps.settingsStore.current)
  }
}

function makeHandleMeetingCreate(deps: IpcRegistryDependencies) {
  return function handleMeetingCreate(raw: unknown): MeetingCreateResponse {
    const req = MeetingCreateRequestSchema.parse(raw)

    const now = new Date(deps.clock?.now() ?? Date.now()).toISOString()
    const meeting: MeetingCreateResponse = {
      id: randomUUID(),
      title: req.title,
      state: 'draft',
      paused: false,
      createdAt: now,
      primaryLanguage: req.primaryLanguage,
    }

    return MeetingCreateResponseSchema.parse(meeting)
  }
}

function makeHandleAgendaItemAdd(): (raw: unknown) => AgendaItemAddResponse {
  return function handleAgendaItemAdd(raw: unknown): AgendaItemAddResponse {
    const req = AgendaItemAddRequestSchema.parse(raw)

    const agendaItem: AgendaItemAddResponse = {
      id: randomUUID(),
      title: req.title,
      topic: req.topic,
    }

    return AgendaItemAddResponseSchema.parse(agendaItem)
  }
}

function makeHandleAgendaItemRemove(): (raw: unknown) => AgendaItemRemoveResponse {
  return function handleAgendaItemRemove(raw: unknown): AgendaItemRemoveResponse {
    AgendaItemRemoveRequestSchema.parse(raw)
    return AgendaItemRemoveResponseSchema.parse({ ok: true })
  }
}

function makeHandleParticipantAdd(): (raw: unknown) => ParticipantAddResponse {
  return function handleParticipantAdd(raw: unknown): ParticipantAddResponse {
    const req = ParticipantAddRequestSchema.parse(raw)

    const participant: ParticipantAddResponse = {
      id: randomUUID(),
      name: req.name,
    }

    return ParticipantAddResponseSchema.parse(participant)
  }
}

function makeHandleParticipantRemove(): (raw: unknown) => ParticipantRemoveResponse {
  return function handleParticipantRemove(raw: unknown): ParticipantRemoveResponse {
    ParticipantRemoveRequestSchema.parse(raw)
    return ParticipantRemoveResponseSchema.parse({ ok: true })
  }
}

function makeHandleMeetingStart(deps: IpcRegistryDependencies) {
  return function handleMeetingStart(raw: unknown): MeetingStartResponse {
    const req = MeetingStartRequestSchema.parse(raw)

    const now = new Date(deps.clock?.now() ?? Date.now()).toISOString()

    // For now, return a live meeting. When integrated with the DB + service,
    // this will load the meeting, validate it, and persist the transition.
    const meeting: MeetingStartResponse = {
      id: req.meetingId,
      title: 'Meeting',
      state: 'live',
      paused: false,
      createdAt: now,
      primaryLanguage: 'nl',
      startedAt: now,
    }

    return MeetingStartResponseSchema.parse(meeting)
  }
}

function makeHandleSecretSet(deps: IpcRegistryDependencies) {
  return function handleSecretSet(raw: unknown): SecretSetResponse {
    const req = SecretSetRequestSchema.parse(raw)
    if (deps.secretStorage === undefined) {
      throw new Error('SecretStorage is not available')
    }
    deps.secretStorage.setSecret(req.key, req.value)
    return SecretSetResponseSchema.parse({ ok: true })
  }
}

function makeHandleSecretHas(deps: IpcRegistryDependencies) {
  return function handleSecretHas(raw: unknown): SecretHasResponse {
    const req = SecretHasRequestSchema.parse(raw)
    if (deps.secretStorage === undefined) {
      return SecretHasResponseSchema.parse({ has: false })
    }
    const has = deps.secretStorage.getSecret(req.key) !== null
    return SecretHasResponseSchema.parse({ has })
  }
}

function makeHandleAudioStart(deps: IpcRegistryDependencies) {
  return function handleAudioStart(raw: unknown): AudioStartResponse {
    AudioStartRequestSchema.parse(raw)
    deps.audioBridge?.start()
    return AudioStartResponseSchema.parse({ ok: true })
  }
}

function makeHandleAudioStop(deps: IpcRegistryDependencies) {
  return function handleAudioStop(raw: unknown): AudioStopResponse {
    AudioStopRequestSchema.parse(raw)
    deps.audioBridge?.stop()
    return AudioStopResponseSchema.parse({ ok: true })
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createIpcRegistry(deps: IpcRegistryDependencies): IpcRegistry {
  // Typed as a partial map so that unknown channels yield undefined at runtime.
  const HANDLERS: Partial<Record<IpcChannel, Handler>> = {
    ping: handlePing,
    'settings:get': makeHandleSettingsGet(deps),
    'settings:set': makeHandleSettingsSet(deps),
    'egress:state': makeHandleEgressState(deps),
    'secret:set': makeHandleSecretSet(deps),
    'secret:has': makeHandleSecretHas(deps),
    'meeting:create': makeHandleMeetingCreate(deps),
    'agendaItem:add': makeHandleAgendaItemAdd(),
    'agendaItem:remove': makeHandleAgendaItemRemove(),
    'participant:add': makeHandleParticipantAdd(),
    'participant:remove': makeHandleParticipantRemove(),
    'meeting:start': makeHandleMeetingStart(deps),
    'audio:start': makeHandleAudioStart(deps),
    'audio:stop': makeHandleAudioStop(deps),
  }

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
