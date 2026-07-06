/**
 * Boundary handler for the one-way renderer→main PCM channels (audit S3).
 *
 * Wraps a downstream sink (`liveSession.pushAudioFrame` / `importSession.push-
 * Frame`) with the cheap runtime guard from `pcmFrameGuard`. Registered at the
 * `ipcMain.on('audio:frame' | 'import:frame')` boundary. An invalid or over-cap
 * payload is DROPPED and devlogged — never thrown — so a bad frame mid-meeting
 * cannot crash the main process.
 */

import { MAX_PCM_FRAME_BYTES, isValidPcmFrame } from '@shared/audio/pcmFrameGuard'
import type { IpcOnewayChannel } from '@shared/ipc'

import { devlog } from '../devlog'

export interface PcmFrameHandlerOptions {
  /** Downstream consumer for a validated frame. */
  sink: (frame: Uint8Array) => void
  /** The channel this handler serves — recorded in the drop devlog. */
  channel: Extract<IpcOnewayChannel, 'audio:frame' | 'import:frame'>
  /** Override the max accepted byte length (defaults to MAX_PCM_FRAME_BYTES). */
  maxBytes?: number
}

/**
 * Build the `ipcMain.on` listener body for a PCM frame channel. Returns a
 * function that validates then forwards (or drops + devlogs) a raw payload.
 */
export function createPcmFrameHandler(opts: PcmFrameHandlerOptions): (frame: unknown) => void {
  const maxBytes = opts.maxBytes ?? MAX_PCM_FRAME_BYTES
  return (frame: unknown): void => {
    if (!isValidPcmFrame(frame, maxBytes)) {
      // Metadata only — never the frame bytes (privacy) and never a throw.
      devlog('audio', 'frame-rejected', {
        channel: opts.channel,
        type: typeof frame,
        byteLength: frame instanceof Uint8Array ? frame.byteLength : undefined,
        maxBytes,
      })
      return
    }
    opts.sink(frame)
  }
}
