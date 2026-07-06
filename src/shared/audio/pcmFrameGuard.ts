/**
 * PCM frame guard — the cheap runtime validation for the one-way renderer→main
 * PCM channels (`audio:frame`, `import:frame`). See audit S3 / ADR 0013.
 *
 * These channels carry raw binary PCM via `ipcRenderer.send` → `ipcMain.on`.
 * The main-side handler annotates the payload as `Uint8Array`, but that is a
 * compile-time claim only: nothing stops a compromised or buggy renderer from
 * sending the wrong type or an absurdly large buffer straight into the audio
 * pipeline. Per-frame Zod would be wasteful for ~16 binary frames/second (the
 * documented ADR 0013 trade-off), so the guard is deliberately cheap: an
 * `instanceof Uint8Array` check plus a maximum byte length.
 */

/**
 * Maximum accepted size, in bytes, of a single PCM frame.
 *
 * Derivation: a legitimate frame is exactly `FRAME_SIZE` (4096) Int16 samples ×
 * 2 bytes = 8192 bytes. Both producers use the same size — `AudioCaptureService`
 * (live) and `AudioFileImportService` (import), each `FRAME_SIZE = 4096`, fed
 * through `PcmFramer` which only ever emits full `frameSize * 2`-byte frames.
 * The cap is 64 KiB, ~8× a real frame, so it never rejects a legitimate frame
 * yet drops clearly-absurd payloads. It is a sanity ceiling, not a tight bound.
 */
export const MAX_PCM_FRAME_BYTES = 64 * 1024

/**
 * Runtime guard for a one-way PCM frame payload. Electron's structured clone
 * delivers the renderer's `Uint8Array` as a `Uint8Array` (a `Buffer`, its
 * subclass, also passes). Anything else — or a payload over `maxBytes` — is
 * rejected so the caller can DROP it. The caller must never throw on a bad
 * frame: a single malformed frame must not take down the main process.
 */
export function isValidPcmFrame(
  payload: unknown,
  maxBytes: number = MAX_PCM_FRAME_BYTES,
): payload is Uint8Array {
  return payload instanceof Uint8Array && payload.byteLength <= maxBytes
}
