/**
 * Pure factory for BrowserWindow construction options.
 *
 * Factored out of createWindow() so the security-flag configuration is
 * testable without launching Electron. The four flags below implement the
 * Electron security baseline (ADR 0005): contextIsolation, no nodeIntegration,
 * sandbox, and a preload script pointing at the compiled preload bundle.
 *
 * Never weaken these flags. If a feature appears to require relaxing them,
 * stop and reconsider the feature design — the answer is almost always to
 * move the capability to the main process and expose it through the IPC bridge.
 */

export interface WindowOptions {
  width: number
  height: number
  icon?: string
  webPreferences: {
    contextIsolation: true
    nodeIntegration: false
    sandbox: true
    preload: string
  }
}

/**
 * Returns BrowserWindow construction options with all security flags locked in.
 *
 * @param preloadPath Absolute path to the compiled preload script
 *                    (e.g. join(__dirname, '../preload/index.js')).
 * @param iconPath    Optional path to the window/taskbar icon (the Steno app
 *                    icon, resolved by electron-vite's `?asset` import). Omitted
 *                    from the result when not supplied so the platform default
 *                    is used (and to satisfy exactOptionalPropertyTypes).
 */
export function createWindowOptions(preloadPath: string, iconPath?: string): WindowOptions {
  return {
    width: 1280,
    height: 800,
    ...(iconPath !== undefined ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  }
}
