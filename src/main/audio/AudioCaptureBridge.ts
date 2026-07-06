/**
 * AudioCaptureBridge (item 0015).
 *
 * Main-process side of the audio streaming pipeline:
 *
 *   renderer (PCM frames via IPC) → AudioCaptureBridge → ASRProvider
 *   ASRProvider (TranscriptSpan events) → AudioCaptureBridge → renderer
 *
 * The bridge is intentionally thin:
 *   - It does not know about getUserMedia or AudioWorklet (renderer concerns).
 *   - It does not build or configure the ASR provider (providerFactory concern).
 *   - It only connects: forward frames in, forward spans out.
 *
 * ## Span forwarding
 * Spans are forwarded to the renderer via a typed sender (webContents.send on
 * the 'transcript:span' channel). The sender is injected so this class is
 * unit-testable without Electron.
 *
 * ## Safety
 * - pushAudioFrame() is a no-op when not started.
 * - Calling start() while already started is ignored (idempotent).
 * - Calling stop() while not started is a no-op.
 */

import type { ASRProvider } from '@shared/providers'

import { devlog } from '../devlog'

// ---------------------------------------------------------------------------
// Injected sender abstraction (testable without Electron webContents)
// ---------------------------------------------------------------------------

export interface IpcSender {
  send(channel: string, ...args: unknown[]): void
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AudioCaptureBridgeOptions {
  /** The ASR provider that consumes audio frames and emits transcript spans. */
  asrProvider: ASRProvider
  /**
   * The IPC sender used to push spans to the renderer.
   * In production this is `mainWindow.webContents`.
   * In tests this is a simple mock.
   */
  sender: IpcSender
  /**
   * Optional observer called for every span emitted by the ASR provider,
   * before the span is forwarded to the renderer. Used by item 0018 to
   * feed spans into the LiveExtractionRuntime without modifying the bridge.
   *
   * The observer receives ALL spans (including interim); filtering (isFinal)
   * is the observer's responsibility.
   */
  onSpan?: (span: import('@shared/domain').TranscriptSpan) => void
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class AudioCaptureBridge {
  private readonly _asr: ASRProvider
  private readonly _sender: IpcSender
  private readonly _onSpan: ((span: import('@shared/domain').TranscriptSpan) => void) | undefined
  private _active = false

  constructor(opts: AudioCaptureBridgeOptions) {
    this._asr = opts.asrProvider
    this._sender = opts.sender
    this._onSpan = opts.onSpan
  }

  /** Start a session: open the ASR provider and begin forwarding spans. */
  start(): void {
    if (this._active) return
    this._active = true
    this._asr.start()
    void this._forwardSpans()
  }

  /** Stop the session: close the ASR provider (span loop completes naturally). */
  stop(): void {
    if (!this._active) return
    this._active = false
    this._asr.stop()
  }

  /**
   * Forward a PCM audio frame to the ASR provider.
   * No-op if the session is not active.
   */
  pushAudioFrame(frame: Uint8Array): void {
    if (!this._active) return
    this._asr.pushAudioFrame(frame)
  }

  // ---------------------------------------------------------------------------
  // Internal: drain the span iterator and forward to renderer
  // ---------------------------------------------------------------------------

  private async _forwardSpans(): Promise<void> {
    for await (const span of this._asr.spans()) {
      // A single span must never tear down the stream. The observer path
      // includes the runtime's DB persistence and the sender can throw if the
      // renderer has gone away mid-meeting. Either throw would otherwise become
      // an unhandled rejection (the loop is fire-and-forget) and could take the
      // app down at the worst possible moment. Catch per span, log via devlog,
      // and keep draining. See audit finding C3.
      try {
        // Notify the optional observer (e.g. LiveExtractionRuntime) before the
        // renderer sees the span. The observer receives interim spans too; it
        // is responsible for its own isFinal filtering.
        this._onSpan?.(span)
        this._sender.send('transcript:span', span)
      } catch (err) {
        devlog('audio', 'span-forward-failed', {
          isFinal: span.isFinal ?? true,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}
