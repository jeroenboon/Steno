/**
 * AudioCaptureService (items 0015 + 0017 — renderer side).
 *
 * Handles the browser-side audio pipeline:
 *   getUserMedia(audio)                 → |
 *                                         | ScriptProcessorNode → PcmFramer → IPC → main
 *   getDisplayMedia(audio, loopback)    → |
 *
 * ## Loopback (item 0017)
 *
 * When mode is 'remote' (the default), the service also captures system audio
 * via getDisplayMedia with { audio: true, video: false }. On Windows/Electron
 * this gives WASAPI loopback — the audio coming out of the speakers (everyone
 * else on the call). The mic and loopback streams are mixed sample-by-sample
 * via the pure mixPcm() function before being pushed through the PcmFramer and
 * on to IPC.
 *
 * When mode is 'mic-only' (in-person), or when getDisplayMedia is denied or
 * cancelled by the user, the service falls back gracefully to mic audio alone.
 * The caller is notified about the actual loopback state via the LoopbackState
 * returned from start().
 *
 * ## CSP note
 * Web Audio / getUserMedia / getDisplayMedia are all 'self'-origin API calls;
 * no remote network requests are involved here. Frames leave the renderer via
 * IPC to main, which forwards them to the configured ASR provider over WSS.
 *
 * ## ScriptProcessorNode note
 * See ADR 0013: ScriptProcessorNode is deprecated but fully supported in all
 * Electron/Chromium versions we target. AudioWorklet requires serving a
 * dedicated worklet URL, adding build complexity without meaningful gain.
 */

import { PcmFramer } from '@shared/audio/pcmFramer'
import { mixPcm } from '@shared/audio/pcmMixer'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Deepgram expects 16 kHz, mono, 16-bit LE PCM. */
const TARGET_SAMPLE_RATE = 16_000

/**
 * Number of Int16 samples per emitted frame.
 * 4096 samples @ 16 kHz = 256 ms per frame.
 */
const FRAME_SIZE = 4096

/**
 * ScriptProcessorNode buffer size (must be a power of 2 between 256–16384).
 */
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Capture mode.
 *
 * 'remote'   — capture mic + system loopback, mix into one stream (default).
 *              Falls back to mic-only if the user denies the display-media picker.
 * 'mic-only' — capture mic only (in-person meeting, no loopback needed).
 */
export type CaptureMode = 'remote' | 'mic-only'

/**
 * Actual loopback state after start() completes.
 *
 * 'active'  — loopback stream acquired and mixed in.
 * 'denied'  — user cancelled / denied the getDisplayMedia picker; falling back
 *             to mic-only. Not an error — the app continues normally.
 * 'off'     — mode was 'mic-only'; loopback not attempted.
 */
export type LoopbackState = 'active' | 'denied' | 'off'

/** Result returned from start(). */
export interface StartResult {
  loopbackState: LoopbackState
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class PermissionDeniedError extends Error {
  constructor() {
    super('Microphone permission denied')
    this.name = 'PermissionDeniedError'
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AudioCaptureService {
  private _context: AudioContext | null = null
  private _micSource: MediaStreamAudioSourceNode | null = null
  private _loopbackSource: MediaStreamAudioSourceNode | null = null
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  private _processor: ScriptProcessorNode | null = null
  private _micStream: MediaStream | null = null
  private _loopbackStream: MediaStream | null = null
  private _framer: PcmFramer | null = null

  /**
   * Start audio capture.
   *
   * @param mode  'remote' (default) to also request system loopback via
   *              getDisplayMedia, 'mic-only' to capture microphone only.
   *
   * @throws PermissionDeniedError  when getUserMedia (mic) is denied.
   * @throws Error                  for other audio setup failures.
   *
   * @returns StartResult describing the actual loopback state. When mode is
   *          'remote' but the user denies the picker, loopbackState is 'denied'
   *          (not an error) and the service continues in mic-only mode.
   */
  async start(mode: CaptureMode = 'remote'): Promise<StartResult> {
    // ------------------------------------------------------------------
    // 1. Microphone (required)
    // ------------------------------------------------------------------
    let micStream: MediaStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      throw new PermissionDeniedError()
    }
    this._micStream = micStream

    // ------------------------------------------------------------------
    // 2. System loopback (optional — only in 'remote' mode)
    // ------------------------------------------------------------------
    let loopbackState: LoopbackState = 'off'

    if (mode === 'remote') {
      const loopbackResult = await this._acquireLoopback()
      if (loopbackResult !== null) {
        this._loopbackStream = loopbackResult
        loopbackState = 'active'
      } else {
        loopbackState = 'denied'
      }
    }

    // ------------------------------------------------------------------
    // 3. Build Web Audio graph
    // ------------------------------------------------------------------
    const context = new AudioContext()
    this._context = context

    const sourceSampleRate = context.sampleRate // typically 48 000 on Windows

    const framer = new PcmFramer({
      sourceSampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
      frameSize: FRAME_SIZE,
    })
    this._framer = framer

    const micSource = context.createMediaStreamSource(micStream)
    this._micSource = micSource

    let loopbackSource: MediaStreamAudioSourceNode | null = null
    if (this._loopbackStream !== null) {
      loopbackSource = context.createMediaStreamSource(this._loopbackStream)
      this._loopbackSource = loopbackSource
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
    this._processor = processor

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    processor.onaudioprocess = (event) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const micData = event.inputBuffer.getChannelData(0)

      // Loopback samples come from a separate MediaStreamSource connected in
      // parallel. We read them from the loopback source's output buffer via a
      // second ScriptProcessorNode (see _loopbackCapture) whose output we keep
      // in _latestLoopbackBuffer, then mix here.
      const loopback = this._latestLoopbackBuffer

      const mixed = mixPcm(micData, loopback)

      framer.push(mixed, (frame) => {
        window.api.audioSendFrame(frame)
      })
    }

    // Connect the mic through the processor
    micSource.connect(processor)
    processor.connect(context.destination)

    // For loopback: create a separate silent processor just to tap samples
    if (loopbackSource !== null) {
      this._startLoopbackCapture(context, loopbackSource)
    }

    // Tell main to open the ASR session
    await window.api.audioStart()

    return { loopbackState }
  }

  /** Stop capture and tear down the audio graph. */
  async stop(): Promise<void> {
    this._loopbackProcessor?.disconnect()
    this._processor?.disconnect()
    this._micSource?.disconnect()
    this._loopbackSource?.disconnect()
    this._framer?.reset()

    await this._context?.close()

    for (const track of this._micStream?.getTracks() ?? []) {
      track.stop()
    }
    for (const track of this._loopbackStream?.getTracks() ?? []) {
      track.stop()
    }

    this._loopbackProcessor = null
    this._processor = null
    this._micSource = null
    this._loopbackSource = null
    this._context = null
    this._framer = null
    this._micStream = null
    this._loopbackStream = null
    this._latestLoopbackBuffer = null

    await window.api.audioStop()
  }

  // ---------------------------------------------------------------------------
  // Loopback capture: secondary ScriptProcessorNode that captures loopback
  // samples into a shared buffer read by the primary processor.
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  private _loopbackProcessor: ScriptProcessorNode | null = null
  private _latestLoopbackBuffer: Float32Array | null = null

  private _startLoopbackCapture(
    context: AudioContext,
    loopbackSource: MediaStreamAudioSourceNode,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const proc = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
    this._loopbackProcessor = proc

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    proc.onaudioprocess = (event) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const data = event.inputBuffer.getChannelData(0)
      // Store a copy; the primary processor picks it up next tick
      this._latestLoopbackBuffer = new Float32Array(data)
    }

    loopbackSource.connect(proc)
    // Connect to destination to keep the graph alive (Web Audio spec requirement)
    proc.connect(context.destination)
  }

  // ---------------------------------------------------------------------------
  // Private: acquire system loopback via getDisplayMedia
  // ---------------------------------------------------------------------------

  /**
   * Try to acquire a system-audio loopback stream via getDisplayMedia.
   *
   * On Windows/Electron with the displayMediaRequestHandler wired in main
   * (item 0017), this resolves to a MediaStream containing system audio without
   * showing a display picker. On other platforms, or when the user cancels, it
   * resolves to null (caller falls back to mic-only).
   *
   * Never throws — any failure mode returns null.
   */
  private async _acquireLoopback(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: false,
      })
      // Verify the stream actually has audio tracks (some platforms return video only)
      if (stream.getAudioTracks().length === 0) {
        for (const t of stream.getTracks()) t.stop()
        return null
      }
      return stream
    } catch {
      // NotAllowedError (user cancelled picker), NotSupportedError, etc.
      return null
    }
  }
}
