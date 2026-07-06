/**
 * IPC contract for main ↔ renderer communication — the single source of truth.
 *
 * Channel names, request/response Zod schemas, push-event payloads, the
 * `IpcChannel` union, and the `RendererApi` interface all live behind this
 * module. The renderer never touches ipcRenderer directly — everything goes
 * through the typed preload bridge (window.api).
 *
 * Zod schemas are the source of truth; TypeScript types derive from them via
 * z.infer.
 *
 * ## Structure (audit A4)
 *
 * The per-channel declarations are grouped into per-domain modules under
 * `./ipc/` (settings, session, items, history, prep, import, model, platform),
 * mirroring the main-process handler modules so the contract and the handlers
 * line up. This file is the **barrel**: it re-exports every domain module and
 * keeps the three cross-cutting pieces that must live in one place —
 *   - the `IpcChannel` union (composed from the per-domain channel unions),
 *   - the `ipcChannelSchemas` registry (composed from the per-domain slices,
 *     with the `satisfies Record<IpcChannel, …>` completeness guard), and
 *   - the `RendererApi` interface (composed from the per-domain API fragments).
 * Importers keep using `@shared/ipc`; only this file's internals moved.
 */

import type { z } from 'zod'

import type { IpcChannelSchema } from './ipc/common'
import { historyChannelSchemas, type HistoryChannel, type HistoryApi } from './ipc/history'
import {
  importChannelSchemas,
  type ImportChannel,
  type ImportApi,
  type ImportOnewayChannel,
} from './ipc/import'
import { itemChannelSchemas, type ItemChannel, type ItemApi } from './ipc/items'
import { modelChannelSchemas, type ModelChannel, type ModelApi } from './ipc/model'
import { platformChannelSchemas, type PlatformChannel, type PlatformApi } from './ipc/platform'
import { prepChannelSchemas, type PrepChannel, type PrepApi } from './ipc/prep'
import {
  sessionChannelSchemas,
  type SessionChannel,
  type SessionApi,
  type SessionOnewayChannel,
} from './ipc/session'
import { settingsChannelSchemas, type SettingsChannel, type SettingsApi } from './ipc/settings'

// Re-export every per-domain contract so `@shared/ipc` stays the one entry point.
export * from './ipc/settings'
export * from './ipc/session'
export * from './ipc/items'
export * from './ipc/history'
export * from './ipc/prep'
export * from './ipc/import'
export * from './ipc/model'
export * from './ipc/platform'
export type { UnsubscribeFn } from './ipc/common'

// ---------------------------------------------------------------------------
// Channel registry — exhaustive union of all invoke channel names
// ---------------------------------------------------------------------------

export type IpcChannel =
  | SettingsChannel
  | SessionChannel
  | ItemChannel
  | HistoryChannel
  | PrepChannel
  | ImportChannel
  | ModelChannel
  | PlatformChannel

/**
 * One-way channels: renderer sends, main receives (no invoke/response).
 * These are registered via ipcMain.on, not ipcMain.handle.
 */
export type IpcOnewayChannel = SessionOnewayChannel | ImportOnewayChannel

// ---------------------------------------------------------------------------
// Channel schema registry — the single map from channel → {request, response}
// Zod schemas, composed from the per-domain slices.
//
// This is the machine-readable form of the contract that the individual
// *RequestSchema / *ResponseSchema exports already declare. The preload's
// generic invoke() helper uses it to Zod-validate every response at the renderer
// boundary (rule #7), replacing the old per-method `as Promise<…>` casts. Each
// per-domain slice is `satisfies Record<ItsChannel, …>` for a local drift guard;
// the `satisfies Record<IpcChannel, …>` here proves every channel has exactly
// one entry, so the union and this map cannot drift.
// ---------------------------------------------------------------------------

export const ipcChannelSchemas = {
  ...settingsChannelSchemas,
  ...sessionChannelSchemas,
  ...itemChannelSchemas,
  ...historyChannelSchemas,
  ...prepChannelSchemas,
  ...importChannelSchemas,
  ...modelChannelSchemas,
  ...platformChannelSchemas,
} satisfies Record<IpcChannel, IpcChannelSchema>

/** Request payload type for a given invoke channel (derived from the registry). */
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof ipcChannelSchemas)[C]['request']>

/** Response payload type for a given invoke channel (derived from the registry). */
export type IpcResponse<C extends IpcChannel> = z.infer<(typeof ipcChannelSchemas)[C]['response']>

// ---------------------------------------------------------------------------
// Typed preload API surface exposed to the renderer via contextBridge —
// composed from the per-domain API fragments.
// ---------------------------------------------------------------------------

export interface RendererApi
  extends SettingsApi, SessionApi, ItemApi, HistoryApi, PrepApi, ImportApi, ModelApi, PlatformApi {}
