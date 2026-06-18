import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'path'

import { app, BrowserWindow, ipcMain, safeStorage, session, desktopCapturer } from 'electron'

import type { IpcChannel } from '@shared/ipc'
import { FakeASRProvider } from '@shared/providers'

import { AudioCaptureBridge } from './audio/AudioCaptureBridge'
import { buildContentSecurityPolicy } from './csp'
import { createIpcRegistry } from './ipc-registry'
import { tryBuildAsrProvider, tryBuildExtractionProvider } from './settings/providerFactory'
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
//
// The policy is dev-aware (see csp.ts): strict in production, relaxed in dev so
// the Vite dev server's inline Fast-Refresh script and HMR websocket can run.
// ---------------------------------------------------------------------------

function applyContentSecurityPolicy(): void {
  const isDev = process.env.ELECTRON_RENDERER_URL !== undefined
  const csp = buildContentSecurityPolicy(isDev)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}

// ---------------------------------------------------------------------------
// Display-media request handler (item 0017 — Windows system-audio loopback)
//
// On Windows, Electron's getDisplayMedia() with { audio: true, video: false }
// can return the WASAPI loopback (system output audio). Without this handler,
// Electron shows a screen-picker dialog to the user, which is confusing for an
// audio-only loopback request.
//
// setDisplayMediaRequestHandler lets us intercept the request and supply a
// source directly. We look for a "Screen N" or "Entire Screen" source (the
// virtual WASAPI loopback device appears under the screen sources), grant the
// first available screen source with audio, and do NOT include video (video:
// false in the renderer's getDisplayMedia call means the video track is present
// in the source but not in the returned stream — the renderer checks
// stream.getAudioTracks() and discards video tracks).
//
// Security posture:
//   - We only grant loopback (audio); we do not capture screen pixels.
//   - The handler runs in the main process; the renderer cannot escalate
//     permissions beyond what this handler allows.
//   - If no source is found, the handler calls request.deny(), which causes
//     getDisplayMedia in the renderer to throw NotAllowedError — the
//     AudioCaptureService catches this and falls back to mic-only.
//
// Platform note (see ADR 0002 amendment):
//   - Windows: WASAPI loopback is available through the screen sources.
//   - macOS/Linux: getDisplayMedia loopback is not reliably available; the
//     handler will find no matching source and deny, causing mic-only fallback.
// ---------------------------------------------------------------------------

function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({
          types: ['screen'],
          // Fetch thumbnail at minimal size — we only need audio, not pixels.
          thumbnailSize: { width: 1, height: 1 },
        })
        .then((sources) => {
          const source = sources[0]
          if (source === undefined) {
            // No screen source available — deny so the renderer falls back to mic-only.
            callback({})
            return
          }

          // Grant the first screen source. The renderer's getDisplayMedia call
          // has video: false so no video frames will be captured or transmitted.
          callback({ video: source, audio: 'loopback' })
        })
        .catch(() => {
          // Any unexpected error → deny cleanly
          callback({})
        })
    },
    // useSystemPicker: false — we supply our own source directly so the user
    // does not see a screen-picker dialog for an audio-only loopback request.
    { useSystemPicker: false },
  )
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
  // ASR and extraction are built INDEPENDENTLY: the ASR provider is gated only
  // on the ASR key (Deepgram), so transcription works as soon as that key is
  // set, regardless of whether an extraction (Anthropic) key exists. A missing
  // ASR key falls back to FakeASRProvider so the app stays alive; the renderer
  // shows a "no key" banner guiding the user to Settings.
  // ---------------------------------------------------------------------------
  const asrResult = tryBuildAsrProvider(settingsStore.current, secretStorage)
  const asrProvider = asrResult.ok ? asrResult.provider : new FakeASRProvider()

  if (!asrResult.ok) {
    console.warn(
      '[LiveTranscriber] ASR provider not ready — ASR key not configured yet. ' +
        'Using FakeASRProvider until the key is set in Settings. ' +
        `Reason: ${asrResult.error}`,
    )
  }

  // Extraction provider seam (item 0018 will wire this into the extraction loop).
  // Built independently so a missing extraction key does NOT disable ASR.
  const extractionResult = tryBuildExtractionProvider(settingsStore.current, secretStorage)
  if (!extractionResult.ok) {
    console.warn(
      '[LiveTranscriber] Extraction provider not ready — extraction key not configured yet. ' +
        `Live extraction will start once the key is set. Reason: ${extractionResult.error}`,
    )
  }

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
  return new BrowserWindow(opts)
}

// Load the renderer. Called AFTER IPC handlers are registered so the renderer
// can never invoke a channel before its handler exists (that race left the
// Settings screen stuck on "Instellingen laden...").
function loadRenderer(mainWindow: BrowserWindow): void {
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
  .then(async () => {
    applyContentSecurityPolicy()
    registerDisplayMediaHandler()
    // Create the window (does NOT load the renderer yet) so registerIpcHandlers
    // can bind to its webContents, THEN register handlers, THEN load the
    // renderer. This ordering guarantees every IPC handler exists before any
    // renderer code can invoke it.
    const mainWindow = createWindow()
    await registerIpcHandlers(mainWindow)
    loadRenderer(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        // IPC handlers are already registered (global on ipcMain); just create
        // and load a fresh window.
        loadRenderer(createWindow())
      }
    })
  })
  .catch(console.error)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
