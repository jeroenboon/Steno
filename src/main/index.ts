import { join } from 'path'

import { app, BrowserWindow, ipcMain, session } from 'electron'

import { createIpcRegistry } from './ipc-registry'
import { createWindowOptions } from './window-options'

// ---------------------------------------------------------------------------
// CSP — applied via session headers rather than a meta tag.
//
// Reason: a meta tag in the HTML only fires after the renderer has already
// parsed the document; a Content-Security-Policy response header is enforced
// by the browser engine before any script runs. The session webRequest hook
// is the correct place for this in Electron because it applies to every
// navigation, including dev-mode HMR reloads, without needing the built HTML
// to carry the header. See ADR 0005.
// ---------------------------------------------------------------------------

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Vite injects inline styles during dev
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    })
  })
}

// ---------------------------------------------------------------------------
// IPC — register the typed registry on the main-process ipcMain
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  const registry = createIpcRegistry()

  ipcMain.handle('ping', (_event, payload: unknown) => {
    return registry.dispatch('ping', payload)
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.js')
  const opts = createWindowOptions(preloadPath)
  const mainWindow = new BrowserWindow(opts)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl !== undefined) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app
  .whenReady()
  .then(() => {
    applyContentSecurityPolicy()
    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
  .catch(console.error)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
