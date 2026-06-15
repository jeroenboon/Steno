import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'path'

import { app, BrowserWindow, ipcMain, session } from 'electron'

import type { IpcChannel } from '@shared/ipc'
import { FakeASRProvider } from '@shared/providers'

import { AudioCaptureBridge } from './audio/AudioCaptureBridge'
import { createIpcRegistry } from './ipc-registry'
import { SettingsStore } from './settings/SettingsStore'
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

// The channels registered here must stay in sync with the IpcChannel union.
const IPC_CHANNELS: IpcChannel[] = [
  'ping',
  'settings:get',
  'settings:set',
  'egress:state',
  'meeting:create',
  'agendaItem:add',
  'agendaItem:remove',
  'participant:add',
  'participant:remove',
  'meeting:start',
  'audio:start',
  'audio:stop',
]

async function registerIpcHandlers(mainWindow: BrowserWindow): Promise<void> {
  const userData = app.getPath('userData')

  const settingsStore = new SettingsStore({
    userDataPath: userData,
    readFile: (filePath) => Promise.resolve(readFileSync(filePath, 'utf8')),
    writeFile: (filePath, content) => {
      writeFileSync(filePath, content, 'utf8')
      return Promise.resolve()
    },
  })

  await settingsStore.load()

  // ---------------------------------------------------------------------------
  // Audio capture bridge (item 0015)
  //
  // For V1 we use a FakeASRProvider until the settings-based provider is wired
  // after the real DeepgramAsrProvider keys are available. When settings include
  // a valid Deepgram key, replace FakeASRProvider with buildProviders().asr.
  // ---------------------------------------------------------------------------
  const audioBridge = new AudioCaptureBridge({
    asrProvider: new FakeASRProvider(),
    sender: mainWindow.webContents,
  })

  // One-way channel: renderer sends PCM frames; no invoke/response.
  ipcMain.on('audio:frame', (_event, frame: Uint8Array) => {
    audioBridge.pushAudioFrame(frame)
  })

  const registry = createIpcRegistry({ settingsStore, audioBridge })

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, (_event, payload: unknown) => {
      return registry.dispatch(channel, payload)
    })
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.js')
  const opts = createWindowOptions(preloadPath)
  const mainWindow = new BrowserWindow(opts)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl !== undefined) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app
  .whenReady()
  .then(async () => {
    applyContentSecurityPolicy()
    // Create window first so registerIpcHandlers can bind to its webContents.
    const mainWindow = createWindow()
    await registerIpcHandlers(mainWindow)

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
