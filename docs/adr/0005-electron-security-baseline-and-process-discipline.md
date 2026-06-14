# Electron security baseline and process discipline

The app enforces a locked-down Electron configuration and a hard split between
what runs in the renderer process and what runs in the main process.

## The baseline

Every `BrowserWindow` is created with:

- `contextIsolation: true` — the renderer's JS context is isolated from the
  preload script's context; there is no shared variable namespace.
- `nodeIntegration: false` — renderer code cannot call Node APIs directly.
- `sandbox: true` — the renderer runs in Chromium's sandboxed process, with no
  access to the OS below what the browser engine exposes.
- `preload` pointing at the compiled preload bundle — the only file that may
  call Electron APIs on the renderer's behalf.

The `webPreferences` object is factored into a pure function (`createWindowOptions`)
so this configuration is unit-testable without launching Electron.

## IPC contract

Main and renderer talk through a single typed bridge:

- The preload exposes one object (`window.api`) via `contextBridge.exposeInMainWorld`.
- The shape of that object is the `RendererApi` type, defined in `src/shared/ipc.ts`
  alongside Zod schemas for every channel's request and response.
- The renderer never imports or uses `ipcRenderer` directly.
- On the main side, a pure `createIpcRegistry()` function registers handlers.
  Every incoming payload is parsed through its Zod schema before the handler
  runs. Unknown channels are rejected with an error, not silently dropped.

## CSP

A strict Content Security Policy is applied via `session.webRequest.onHeadersReceived`
rather than a `<meta>` tag. The session hook fires before any script runs and
applies to every navigation, including HMR reloads in dev. A `<meta>` tag would
only activate after the document is parsed — too late if the document itself
carries injected content. The policy is `default-src 'self'` with
`style-src 'self' 'unsafe-inline'` to permit Vite's dev-mode inline style
injection (acceptable in dev; production only loads from `'self'`).

## Process discipline

Renderer = UI only. Every call that touches the OS, the file system, the DB,
API keys, or a provider SDK runs in the main process and is reachable via the
IPC bridge. This is not just a security preference — it is what makes the
heavy, logic-dense code unit-testable without a browser environment.

## Why this is recorded here

These constraints are:

- **Hard to reverse.** Enabling `nodeIntegration` or disabling `contextIsolation`
  later would silently break the security model without a compiler error.
- **Surprising to newcomers.** A developer who reaches for `require('fs')` in a
  component or tries to call an Electron API from the renderer will be confused
  by the error until they understand this model.
- **A real trade-off.** The renderer cannot use any Node or Electron API directly.
  Features that would be trivial with `nodeIntegration: true` (reading a file,
  getting app paths) require an extra IPC round-trip. That cost is deliberate:
  the app handles meeting audio and API keys; a compromised renderer must not
  reach either.

## Considered alternatives

- **`nodeIntegration: true`:** rejected. Gives renderer code direct OS access;
  any XSS in the renderer becomes a full system compromise.
- **`contextIsolation: false`:** rejected. The preload and renderer would share
  a JS heap, making it trivial to exfiltrate preload-level Electron APIs from
  the renderer.
- **`sandbox: false`:** rejected. Removes Chromium's process-level isolation.
  No benefit to us; all cost.
- **CSP via `<meta>` tag:** rejected in favour of the session hook. See CSP
  section above.
