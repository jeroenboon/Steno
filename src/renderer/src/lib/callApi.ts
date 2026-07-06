/**
 * callApi — the thin wrapper around a renderer→main IPC call.
 *
 * Every screen had ~a dozen copies of
 *   `try { await window.api.x(...) } catch (err) { console.error('[Screen] x failed:', err) }`
 * These are deliberately fire-and-forget: item mutations round-trip through main
 * which pushes the authoritative state back (ADR 0033), so the renderer never
 * needs the return value on the happy path and only logs on failure.
 *
 * callApi collapses that shape. It is log-only by design (the app surfaces no
 * user-facing error state for these calls today); the boolean return lets the
 * few callers that have success/failure side-effects branch on the outcome.
 *
 * Not a hook — there is no state to hold. A plain async function keeps it honest
 * and usable from anywhere (handlers, effects, event callbacks).
 */
export async function callApi(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    console.error(`[${label}] failed:`, err)
    return false
  }
}
