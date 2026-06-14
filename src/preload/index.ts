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

import type { RendererApi } from '@shared/ipc'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke('ping', {}),
}

contextBridge.exposeInMainWorld('api', api)
