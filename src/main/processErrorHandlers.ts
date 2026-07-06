/**
 * Process-level error backstop (audit finding C3).
 *
 * The span-forwarding loop (and other fire-and-forget async work in main) can
 * throw far from any awaiter. Without a backstop, such a rejection reaches
 * Electron's default handler, which can take the whole app down — the worst
 * possible moment for a live note-taking tool. This installs a last-resort
 * `unhandledRejection` handler that records the reason via the project devlog
 * instead of crashing silently.
 *
 * The primary defence still lives at the throw site (see AudioCaptureBridge's
 * per-span try/catch). This is the safety net for everything that slips past.
 */

import { devlog } from './devlog'

/** Record a stray unhandled rejection via the structured devlog sink. */
export function logUnhandledRejection(reason: unknown): void {
  devlog('app', 'unhandled-rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  })
}

/**
 * Install the process-level backstop. Call once, early in main-process startup.
 */
export function installProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    logUnhandledRejection(reason)
  })
}
