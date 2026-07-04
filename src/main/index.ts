import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'path'

import Database from 'better-sqlite3'
import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  session,
  desktopCapturer,
  dialog,
  clipboard,
} from 'electron'

import { toTranscriptText } from '@shared/export/meetingExporter'
import type { IpcChannel } from '@shared/ipc'
import { RealClock } from '@shared/providers'

// The Steno app icon (window + taskbar). `?asset` lets electron-vite copy the
// file into the build output and hand back a path that resolves in dev and prod.
import appIconPath from '../../resources/icon.png?asset'

import { buildContentSecurityPolicy } from './csp'
import { runMigrations } from './db/migrate'
import { actionRepo } from './db/repos/actionRepo'
import { agendaItemRepo } from './db/repos/agendaItemRepo'
import { decisionRepo } from './db/repos/decisionRepo'
import { discussionSummaryRepo } from './db/repos/discussionSummaryRepo'
import { meetingRepo } from './db/repos/meetingRepo'
import { participantRepo } from './db/repos/participantRepo'
import { transcriptSpanRepo } from './db/repos/transcriptSpanRepo'
import { createIpcRegistry } from './ipc-registry'
import { ModelDownloader } from './providers/sherpa/ModelDownloader'
import { ItemLifecycleService } from './services/itemLifecycleService'
import { MeetingLifecycleService } from './services/meetingLifecycleService'
import { ImportSessionController } from './session/ImportSessionController'
import { LiveSessionController } from './session/LiveSessionController'
import { testProviderConnection } from './settings/connectionTest'
import { tryBuildExtractionProvider } from './settings/providerFactory'
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

// ---------------------------------------------------------------------------
// Media permission handlers (microphone via getUserMedia)
//
// getUserMedia and getDisplayMedia both pass through Electron's permission gate
// before Chromium grants device access. Electron ships no UI to prompt the user,
// so when no handler is registered the grant behaviour is an undocumented default
// that has changed between versions — relying on it is how mic capture silently
// fails to start. We grant audio capture explicitly and deny everything else,
// which matches the locked-down posture of ADR 0005 (this is a local desktop app
// that needs the microphone and nothing else from the browser permission set).
//
// Note: getDisplayMedia (loopback) is gated by setDisplayMediaRequestHandler
// below, not by this handler; 'media' here covers the getUserMedia mic request.
// On Windows the OS-level microphone privacy setting still applies on top of
// this — if that is off, getUserMedia rejects (mic shows as "denied") rather
// than hanging.
// ---------------------------------------------------------------------------

function registerMediaPermissionHandlers(): void {
  const isMediaPermission = (permission: string): boolean =>
    permission === 'media' || permission === 'audioCapture'

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isMediaPermission(permission))
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    isMediaPermission(permission),
  )
}

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
  'provider:testConnection',
  'meeting:create',
  'agendaItem:add',
  'agendaItem:remove',
  'participant:add',
  'participant:remove',
  'meeting:start',
  'audio:start',
  'audio:stop',
  'item:confirm',
  'item:editAndConfirm',
  'item:dismiss',
  'item:createConfirmed',
  'summary:query',
  'meeting:end',
  'export:markdown',
  'export:copyMarkdown',
  'transcript:copy',
  'meeting:list',
  'meeting:load',
  'meeting:delete',
  'model:status',
  'model:download',
  'import:start',
  'import:finish',
  'context:inferFromText',
  'agendaItem:confirm',
  'agendaItem:editAndConfirm',
  'meeting:pause',
  'meeting:resume',
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
  // SQLite DB + repos (item 0018 wiring)
  //
  // Opened once per app session; migrations run on startup (forward-only,
  // principle #13). The DB file lives in userData alongside settings.
  // ---------------------------------------------------------------------------
  const dbPath = join(userData, 'livetranscriber.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)

  const dRepo = decisionRepo(db)
  const aRepo = actionRepo(db)
  const spanRepo = transcriptSpanRepo(db)
  const dsRepo = discussionSummaryRepo(db)
  const mRepo = meetingRepo(db)
  const aiRepo = agendaItemRepo(db)
  const pRepo = participantRepo(db)

  // Shared ItemLifecycleService for note-taker action IPC (item 0018).
  // The LiveExtractionRuntime builds its own intercepting subclass from the same
  // repos; this instance is for direct note-taker operations (confirm/dismiss/edit).
  const itemService = new ItemLifecycleService(dRepo, aRepo)

  // ---------------------------------------------------------------------------
  // Extraction provider (item 0018 — wired into live extraction runtime)
  //
  // Built at startup so the extraction key is checked early. Rebuilt on
  // audio:start so changes in Settings take effect without an app restart.
  // If the key is absent, the runtime operates in degraded mode: spans are
  // persisted but extraction and IPC item events do not run (no crash).
  // ---------------------------------------------------------------------------
  const extractionResult = tryBuildExtractionProvider(settingsStore.current, secretStorage)
  if (!extractionResult.ok) {
    console.warn(
      '[LiveTranscriber] Extraction provider not ready — extraction key not configured yet. ' +
        'Live extraction will start once the key is set in Settings. ' +
        `Reason: ${extractionResult.error}`,
    )
  }

  // ---------------------------------------------------------------------------
  // Live session controller (architecture task 1)
  //
  // Owns the lifecycle of one live meeting: build ASR provider + runtime +
  // AudioCaptureBridge on start, tear down on stop, run the final pass on end.
  // Extracted out of this function so the lifecycle (where the audio start/stop
  // bugs hid) has locality and a unit-test surface — no Electron dependency.
  // ---------------------------------------------------------------------------
  // Single enforcer of Draft → Live → Ended (and the paused sub-state). Shared
  // across the session controllers (start/end) and the pause/resume IPC path so
  // every transition goes through one place.
  const meetingLifecycle = new MeetingLifecycleService(mRepo, new RealClock())

  const liveSession = new LiveSessionController({
    settingsStore,
    secretStorage,
    decisionRepo: dRepo,
    actionRepo: aRepo,
    transcriptSpanRepo: spanRepo,
    discussionSummaryRepo: dsRepo,
    meetingRepo: mRepo,
    agendaItemRepo: aiRepo,
    participantRepo: pRepo,
    sender: mainWindow.webContents,
    clock: new RealClock(),
    meetingLifecycle,
  })

  // ---------------------------------------------------------------------------
  // Import session controller (item 0026)
  //
  // Owns one offline audio-file import: transcribe decoded PCM through the ASR
  // provider, persist spans, optionally infer the agenda + participants, run the
  // same final pass as a live meeting, and mark the meeting Ended. Progress is
  // pushed to the renderer via webContents on the import:progress channel.
  // ---------------------------------------------------------------------------
  const importSession = new ImportSessionController({
    settingsStore,
    secretStorage,
    meetingRepo: mRepo,
    agendaItemRepo: aiRepo,
    participantRepo: pRepo,
    transcriptSpanRepo: spanRepo,
    decisionRepo: dRepo,
    actionRepo: aRepo,
    discussionSummaryRepo: dsRepo,
    sender: mainWindow.webContents,
    clock: new RealClock(),
    meetingLifecycle,
  })

  // One-way channel: renderer sends PCM frames; no invoke/response.
  // Forwards to whichever bridge is currently active.
  ipcMain.on('audio:frame', (_event, frame: Uint8Array) => {
    liveSession.pushAudioFrame(frame)
  })

  // One-way channel: renderer streams decoded file PCM during an import.
  ipcMain.on('import:frame', (_event, frame: Uint8Array) => {
    importSession.pushFrame(frame)
  })

  const registry = createIpcRegistry({
    settingsStore,
    secretStorage,
    testConnection: (role) =>
      testProviderConnection({ role, settings: settingsStore.current, storage: secretStorage }),
    itemLifecycleService: itemService,
    onAudioStart: (meetingId) => {
      liveSession.start(meetingId)
    },
    onAudioStop: () => {
      liveSession.stop()
    },
    summaryQuery: (question) => liveSession.querySummary(question),
    onMeetingEnd: (meetingId) => liveSession.endMeeting(meetingId),
    onExportFile: async ({ content, defaultFilename, filters }) => {
      // Anchor the dialog to a fast, known folder (Documents). A bare relative
      // filename makes Windows resolve the default directory against the process
      // CWD, which can make the native save dialog slow to appear.
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: join(app.getPath('documents'), defaultFilename),
        filters,
      })
      if (result.canceled || result.filePath === '') {
        return { ok: false, reason: 'cancelled' }
      }
      try {
        writeFileSync(result.filePath, content, 'utf8')
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
    onCopyToClipboard: (content) => {
      clipboard.writeText(content)
    },
    onCopyTranscript: (meetingId) => {
      const spans = spanRepo.listByMeeting(meetingId)
      clipboard.writeText(toTranscriptText(spans))
    },
    meetingList: () => {
      return mRepo.list().filter((m) => m.state !== 'draft')
    },
    meetingLoad: (meetingId) => {
      const meeting = mRepo.findById(meetingId)
      if (meeting === null) return null
      return {
        meeting,
        decisions: dRepo.listByMeeting(meetingId),
        actions: aRepo.listActionsByMeeting(meetingId),
        agendaItems: aiRepo.listByMeeting(meetingId),
        participants: pRepo.listByMeeting(meetingId),
        summaries: dsRepo.listByMeeting(meetingId),
      }
    },
    meetingDelete: (meetingId) => {
      mRepo.delete(meetingId)
    },
    modelDownloader: new ModelDownloader(join(userData, 'models', 'whisper-small-sherpa')),
    pushModelProgress: (evt) => {
      mainWindow.webContents.send('model:progress', evt)
    },
    onImportStart: (req) => {
      const meetingId = randomUUID()
      importSession.start({ meetingId, ...req })
      return meetingId
    },
    onImportFinish: (meetingId) => importSession.finish(meetingId),
    inferContextFromText: async (req) => {
      // Rebuild the provider each call so a key set in Settings takes effect
      // without restart. Degrade to an empty context when extraction is not
      // configured or the provider can't infer (manual Draft entry still works).
      const built = tryBuildExtractionProvider(settingsStore.current, secretStorage)
      if (!built.ok || built.provider.inferContext === undefined) {
        return { agendaItems: [], participants: [] }
      }
      return built.provider.inferContext({ source: { text: req.text } })
    },
    agendaItemRepo: aiRepo,
    onMeetingPause: (meetingId) => {
      const meeting = meetingLifecycle.pauseMeeting(meetingId)
      liveSession.pause()
      return meeting
    },
    onMeetingResume: (meetingId) => {
      const meeting = meetingLifecycle.resumeMeeting(meetingId)
      liveSession.resume()
      return meeting
    },
    meetingRepo: mRepo,
  })

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
  const opts = createWindowOptions(preloadPath, appIconPath)
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
    registerMediaPermissionHandlers()
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
