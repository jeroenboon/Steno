/**
 * Navigation guards (S2 hardening — Electron security checklist, ADR 0005).
 *
 * The Electron security guidance says to explicitly deny new-window creation
 * and any navigation away from the app's own content. Exposure here is already
 * small (strict CSP, sandbox, no remote content, no openExternal), but these
 * guards are cheap defence-in-depth against a compromised renderer being coaxed
 * into opening a window or navigating to an attacker origin.
 *
 * The allow/deny logic is factored into pure predicates (the `window-options.ts`
 * pattern) so it is testable without launching Electron; index.ts stays a thin
 * composition root that wires these onto the window's webContents.
 */

/**
 * Handler for `webContents.setWindowOpenHandler`. New windows are never needed
 * (the app is a single-window desktop UI), so every request is denied.
 */
export function denyWindowOpen(): { action: 'deny' } {
  return { action: 'deny' }
}

/**
 * Predicate for the `will-navigate` guard: does `targetUrl` point at the app's
 * own content and therefore stay allowed?
 *
 * In development the renderer is served from the Vite dev server, so the allowed
 * origin is that dev-server URL (`ELECTRON_RENDERER_URL`). In production the
 * renderer is loaded from a local `file:` URL, so any `file:` navigation is the
 * app's own content. Everything else (an external http(s) origin, a look-alike
 * host, an unparseable string) is denied.
 *
 * Origins are compared via the URL parser rather than string prefixes so a host
 * like `localhost:5173.evil.com` cannot slip through by sharing the dev URL as a
 * textual prefix.
 *
 * @param targetUrl      The URL the renderer is attempting to navigate to.
 * @param rendererDevUrl The dev-server URL when running in dev
 *                       (`process.env.ELECTRON_RENDERER_URL`), otherwise
 *                       `undefined` for a packaged (production) build.
 */
export function isNavigationAllowed(
  targetUrl: string,
  rendererDevUrl: string | undefined,
): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }

  if (rendererDevUrl !== undefined) {
    try {
      return target.origin === new URL(rendererDevUrl).origin
    } catch {
      return false
    }
  }

  // Production: the renderer is loaded from a local file: URL.
  return target.protocol === 'file:'
}
