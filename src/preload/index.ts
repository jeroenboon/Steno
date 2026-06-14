/**
 * Preload script — the only bridge between the renderer and the main process.
 *
 * Rules:
 * - Only contextBridge.exposeInMainWorld may be used here. No direct Node
 *   API calls that would leak privileged access to the renderer.
 * - The exposed API surface must exactly match the RendererApi type from
 *   @shared/ipc so the renderer gets full TypeScript coverage with zero
 *   raw ipcRenderer usage.
 */

import { contextBridge, ipcRenderer } from 'electron'

import type {
  RendererApi,
  SettingsSetRequest,
  EgressState,
  SettingsGetResponse,
  SettingsSetResponse,
} from '@shared/ipc'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke('ping', {}) as Promise<{ pong: true }>,
  settingsGet: () => ipcRenderer.invoke('settings:get', {}) as Promise<SettingsGetResponse>,
  settingsSet: (settings: SettingsSetRequest) =>
    ipcRenderer.invoke('settings:set', settings) as Promise<SettingsSetResponse>,
  egressState: () => ipcRenderer.invoke('egress:state', {}) as Promise<EgressState>,
}

contextBridge.exposeInMainWorld('api', api)
