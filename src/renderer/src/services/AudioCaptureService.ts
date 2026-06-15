/**
 * AudioCaptureService (item 0015 — renderer side).
 *
 * Handles the browser-side audio pipeline:
 *   getUserMedia(audio) → ScriptProcessorNode → PcmFramer → IPC → main
 *
 * This module is NOT unit-tested directly (it wraps browser APIs). The pure
 * logic (PcmFramer) is tested separately in src/shared/audio/pcmFramer.test.ts.
 *
 * ## Design
 * - Uses ScriptProcessorNode rather than AudioWorklet for simplicity. Both
 *   expose raw Float32 PCM samples. AudioWorklet runs in a dedicated thread
 *   but requires serving the worklet script from a URL, which adds build
 *   complexity without meaningful quality gain for the speech-rate sample
 *   sizes Deepgram expects.
 * - The service is a class so the caller (LiveScreen) can stop() it on unmount.
 * - Permission denial is signalled by throwing a PermissionDeniedError, which
 *   the caller catches and stores in the Zustand MicPermission state.
 *
 * ## CSP note
 * Web Audio / getUserMedia are both 'self'-origin API calls; no remote network
 * requests are involved here. The audio frames leave the renderer via IPC to
 * main, which then forwards them to the configured ASR provider over HTTPS/WSS.
 */

import { PcmFramer } from '@shared/audio/pcmFramer'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Deepgram expects 16 kHz, mono, 16-bit LE PCM. */
const TARGET_SAMPLE_RATE = 16_000

/**
 * Number of Int16 samples per emitted frame.
 * 4096 samples @ 16 kHz = 256 ms per frame.
 * This is a good balance: small enough for low latency, large enough for
 * Deepgram not to waste round-trips.
 */
const FRAME_SIZE = 4096

/**
 * ScriptProcessorNode buffer size (must be a power of 2 between 256 and 16384).
 * 4096 matches our target frame size when the source rate is 16 kHz, or gives
 * us roughly 85 ms chunks at 48 kHz before resampling.
 */
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096

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
  private _source: MediaStreamAudioSourceNode | null = null
  // ScriptProcessorNode is deprecated but fully supported in all Chromium versions
  // that ship with Electron. AudioWorklet is the future but requires serving a
  // dedicated worklet script URL, which adds unnecessary build complexity here.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  private _processor: ScriptProcessorNode | null = null
  private _stream: MediaStream | null = null
  private _framer: PcmFramer | null = null

  /**
   * Start microphone capture.
   *
   * @throws PermissionDeniedError  when getUserMedia is denied by the user or OS.
   * @throws Error                  for other audio setup failures.
   */
  async start(): Promise<void> {
    // Request mic access
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      // NotAllowedError / PermissionDeniedError from getUserMedia
      throw new PermissionDeniedError()
    }

    this._stream = stream

    // Construct the Web Audio graph
    const context = new AudioContext()
    this._context = context

    const sourceSampleRate = context.sampleRate // typically 48 000 on Windows

    const framer = new PcmFramer({
      sourceSampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
      frameSize: FRAME_SIZE,
    })
    this._framer = framer

    const source = context.createMediaStreamSource(stream)
    this._source = source

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
    this._processor = processor

    // ScriptProcessorNode and its onaudioprocess/inputBuffer are deprecated in
    // favour of AudioWorklet, but AudioWorklet requires serving a dedicated
    // worklet script URL which adds build complexity. ScriptProcessorNode is
    // fully supported in all Electron/Chromium versions we target.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    processor.onaudioprocess = (event) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const inputData = event.inputBuffer.getChannelData(0)
      framer.push(inputData, (frame) => {
        window.api.audioSendFrame(frame)
      })
    }

    source.connect(processor)
    processor.connect(context.destination)

    // Tell main to open the ASR session
    await window.api.audioStart()
  }

  /** Stop capture and tear down the audio graph. */
  async stop(): Promise<void> {
    this._processor?.disconnect()
    this._source?.disconnect()
    this._framer?.reset()

    await this._context?.close()

    for (const track of this._stream?.getTracks() ?? []) {
      track.stop()
    }

    this._processor = null
    this._source = null
    this._context = null
    this._framer = null
    this._stream = null

    await window.api.audioStop()
  }
}
