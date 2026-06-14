import { contextBridge } from 'electron'

// Expose a typed API to the renderer via contextBridge.
// The full IPC contract will be built out in item 0002.
contextBridge.exposeInMainWorld('api', {
  // Placeholder — typed IPC bridge added in item 0002
})
