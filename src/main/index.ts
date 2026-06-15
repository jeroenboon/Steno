import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'path'

import { app, BrowserWindow, ipcMain, safeStorage, session } from 'electron'

import type { IpcChannel } from '@shared/ipc'
import { FakeASRProvider } from '@shared/providers'

import { AudioCaptureBridge } from './audio/AudioCaptureBridge'
import { createIpcRegistry } from './ipc-registry'
import { tryBuildProviders } from './settings/providerFactory'
import { ElectronSecretStorage } from './settings/SecretStorage'
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
  'secret:set',
  'secret:has',
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
  // SecretStorage (item 0016)
  //
  // ElectronSecretStorage wraps safeStorage (DPAPI on Windows) and a JSON file
  // in userData. It is only safe to instantiate after app.whenReady().
  // ---------------------------------------------------------------------------
  const secretStorage = new ElectronSecretStorage({
    userDataPath: userData,
    safeStorage: {
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (buf) => safeStorage.decryptString(buf),
    },
    readFileSync: (filePath) => readFileSync(filePath, 'utf8'),
    writeFileSync: (filePath, data) => {
      writeFileSync(filePath, data, 'utf8')
    },
  })

  // ---------------------------------------------------------------------------
  // ASR provider (item 0016 — replaces FakeASRProvider from item 0015)
  //
  // tryBuildProviders does not throw; if keys are missing it returns an error
  // result and we fall back to FakeASRProvider so the app stays alive. The
  // renderer will display a "no key configured" banner guiding the user to
  // Settings (via secret:has → App.tsx keysConfigured state).
  //
  // Extraction provider seam: tryBuildProviders also constructs the configured
  // ExtractionProvider. It is available via buildResult.providers.extraction
  // for the extraction loop when item 0018 wires that up. For now we construct
  // it here to prove the factory works; the live extraction startup is item 0018.
  // ---------------------------------------------------------------------------
  const buildResult = tryBuildProviders(settingsStore.current, secretStorage)

  const asrProvider = buildResult.ok ? buildResult.providers.asr : new FakeASRProvider()

  if (!buildResult.ok) {
    console.warn(
      '[LiveTranscriber] Providers not ready — keys not configured yet. ' +
        'Using FakeASRProvider until keys are set in Settings. ' +
        `Reason: ${buildResult.error}`,
    )
  }

  // Extraction provider seam (item 0018 will wire this into the extraction loop):
  // const extractionProvider = buildResult.ok ? buildResult.providers.extraction : null

  const audioBridge = new AudioCaptureBridge({
    asrProvider,
    sender: mainWindow.webContents,
  })

  // One-way channel: renderer sends PCM frames; no invoke/response.
  ipcMain.on('audio:frame', (_event, frame: Uint8Array) => {
    audioBridge.pushAudioFrame(frame)
  })

  const registry = createIpcRegistry({ settingsStore, secretStorage, audioBridge })

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
