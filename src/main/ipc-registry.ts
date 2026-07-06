/**
 * Pure IPC handler registry for the main process — the composer.
 *
 * createIpcRegistry() returns a registry with a dispatch() method. All IPC
 * payloads are validated with Zod before reaching the handler (in the per-domain
 * modules). Unknown channels are rejected at runtime, not silently swallowed.
 *
 * This is a pure function (no Electron imports) so it can be unit-tested without
 * launching Electron.
 *
 * ## Dependency injection: grouped role interfaces (audit A2a)
 *
 * Handlers that depend on stateful collaborators are injected at registry
 * creation time. Item 0012 injected them as a flat *bag of ~30 optional
 * callbacks*, which made `index.ts` wire ~30 forwarder lambdas and let this
 * surface grow unbounded. They are now grouped into a handful of narrow **role
 * interfaces** (`SessionOps`, `ItemOps`, `HistoryOps`, `ImportOps`, `ModelOps`,
 * `ProviderOps`, `PlatformOps`, `PrepDeps`) that the real collaborators already
 * satisfy, so `index.ts` passes objects (`session: liveSession`) instead of
 * lambdas. The registry still depends only on these **ports**, never on the
 * concrete controller classes, so fakes implement them and the registry stays
 * unit-testable without Electron (the item-0012 property). `settingsStore`,
 * `secretStorage` and `clock` stay top-level (needed almost everywhere). The
 * genuinely Electron-native side effects live in `PlatformOps`, built in
 * `index.ts`. See ADR 0038.
 *
 * ## Per-domain handler modules (audit A2b)
 *
 * The handler factories + the role interface each consumes live in per-domain
 * modules under `./ipc/` (sessionHandlers, itemHandlers, historyHandlers,
 * prepHandlers, importHandlers, modelHandlers, platformHandlers,
 * settingsHandlers). This file is now the thin composer: it aggregates their dep
 * slices into `IpcRegistryDependencies`, spreads their handler maps into one
 * `HANDLERS` map, and owns dispatch + the unknown-channel guard. The role
 * interfaces are re-exported here so consumers (`index.ts`, tests) keep a single
 * import site. See ADR 0038.
 */

import type { IpcChannel } from '@shared/ipc'

import type { Handler } from './ipc/handlerTypes'
import { createHistoryHandlers, type HistoryHandlerDeps } from './ipc/historyHandlers'
import { createImportHandlers, type ImportHandlerDeps } from './ipc/importHandlers'
import { createItemHandlers, type ItemHandlerDeps } from './ipc/itemHandlers'
import { createModelHandlers, type ModelHandlerDeps } from './ipc/modelHandlers'
import { createPlatformHandlers, type PlatformHandlerDeps } from './ipc/platformHandlers'
import { createPrepHandlers, type PrepHandlerDeps } from './ipc/prepHandlers'
import { createSessionHandlers, type SessionHandlerDeps } from './ipc/sessionHandlers'
import { createSettingsHandlers, type SettingsHandlerDeps } from './ipc/settingsHandlers'

// Re-export the role interfaces so consumers keep a single import site
// (`./ipc-registry`) rather than reaching into the per-domain modules.
export type { SessionOps } from './ipc/sessionHandlers'
export type { ItemOps } from './ipc/itemHandlers'
export type { HistoryOps } from './ipc/historyHandlers'
export type { ImportOps } from './ipc/importHandlers'
export type { ModelOps } from './ipc/modelHandlers'
export type { PlatformOps } from './ipc/platformHandlers'
export type { ProviderOps } from './ipc/settingsHandlers'
export type { PrepDeps } from './ipc/prepHandlers'

// ---------------------------------------------------------------------------
// Dependencies — the aggregate of every per-domain dep slice
// ---------------------------------------------------------------------------

export interface IpcRegistryDependencies
  extends
    SettingsHandlerDeps,
    SessionHandlerDeps,
    ItemHandlerDeps,
    HistoryHandlerDeps,
    ImportHandlerDeps,
    ModelHandlerDeps,
    PlatformHandlerDeps,
    PrepHandlerDeps {
  /** Database instance (optional, for future persistence). */
  db?: unknown
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
// Factory
// ---------------------------------------------------------------------------

export function createIpcRegistry(deps: IpcRegistryDependencies): IpcRegistry {
  // Each per-domain module contributes the handlers for its channels; spreading
  // them yields the full map. Typed as a partial map so unknown channels yield
  // undefined at runtime (caught by the dispatch guard below).
  const HANDLERS: Partial<Record<IpcChannel, Handler>> = {
    ...createSettingsHandlers(deps),
    ...createSessionHandlers(deps),
    ...createItemHandlers(deps),
    ...createHistoryHandlers(deps),
    ...createPrepHandlers(deps),
    ...createImportHandlers(deps),
    ...createModelHandlers(deps),
    ...createPlatformHandlers(deps),
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
