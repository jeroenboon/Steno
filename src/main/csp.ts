/**
 * Content-Security-Policy builder (item 0002 / ADR 0005, dev-fix item 0017).
 *
 * Production keeps a strict policy: `script-src 'self'`, no inline, no eval.
 * Development must be looser because electron-vite serves the renderer from a
 * local dev server (http://localhost:****) and the React Fast Refresh plugin
 * injects an INLINE module script plus needs `eval` for HMR. A strict
 * `script-src 'self'` blocks that inline bootstrap, leaving a blank white
 * window. So in dev we allow `'unsafe-inline'`/`'unsafe-eval'` for scripts and
 * websocket connections for HMR. None of this relaxation ships to production.
 */

export function buildContentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'"

  // HMR uses a websocket back to the dev server; allow ws/wss in dev only.
  const connectSrc = isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'"

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'", // Vite injects inline styles in both modes
    "img-src 'self' data:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}
