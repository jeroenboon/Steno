/**
 * AudioFileImportService (item 0026 — renderer side).
 *
 * Decodes a user-picked audio file and streams it to main as 16 kHz mono 16-bit
 * LE PCM frames, exactly the format the live capture pipeline uses. This is the
 * import-side counterpart of AudioCaptureService: same frame contract, different
 * source (a decoded file instead of mic/loopback).
 *
 * Pipeline:
 *   decodeAudioData(file) → downmix to mono → PcmFramer (resample to 16 kHz,
 *   chunk into 4096-sample Int16 frames) → window.api.importSendFrame()
 *
 * Orchestration: importStart() first (main creates the meeting + opens the ASR
 * session), then the frames, then importFinish() (main runs the final pass and
 * ends the meeting). The returned meeting id is what the screen opens in Review.
 *
 * ## Testability
 * The Web Audio decoder and the IPC api are injected, so the resample/stream
 * logic is fully testable in jsdom without real decodeAudioData. The default
 * decoder uses an OfflineAudioContext; the default api is window.api.
 *
 * ## Throttling
 * Local Whisper consumes frames as fast as they arrive. A cloud streaming ASR
 * can be flooded faster than realtime, so an optional throttleMs paces the
 * per-chunk pushes. Default is 0 (no throttle) — fine for the local path.
 */

import { PcmFramer } from '@shared/audio/pcmFramer'
import type { ImportStartRequest } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Constants — must match the live capture frame contract
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_RATE = 16_000
const FRAME_SIZE = 4096
/** Source samples pushed to the framer per iteration (progress + throttle granularity). */
const CHUNK_SAMPLES = 16_384

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decoded audio: one Float32Array per channel, plus the source sample rate. */
export interface DecodedAudio {
  channelData: Float32Array[]
  sampleRate: number
}

/** Decodes a file blob into channel data. Injected for testability. */
export type AudioDecoder = (source: Blob) => Promise<DecodedAudio>

/** The subset of the IPC api this service needs. */
export interface ImportApi {
  importStart: (req: ImportStartRequest) => Promise<{ meetingId: string }>
  importSendFrame: (frame: Uint8Array) => void
  importFinish: (req: { meetingId: string }) => Promise<{ meetingId: string }>
}

export interface AudioFileImportServiceOptions {
  /** IPC api. Defaults to window.api. */
  api?: ImportApi
  /** Audio decoder. Defaults to an OfflineAudioContext-based decoder. */
  decoder?: AudioDecoder
}

export interface StreamFileOptions {
  /** Called with decode/stream progress in [0, 1]. */
  onProgress?: (fraction: number) => void
  /** Milliseconds to wait between source chunks (paces a cloud ASR). Default 0. */
  throttleMs?: number
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AudioFileImportService {
  private readonly _api: ImportApi
  private readonly _decoder: AudioDecoder

  constructor(opts: AudioFileImportServiceOptions = {}) {
    this._api = opts.api ?? window.api
    this._decoder = opts.decoder ?? defaultDecoder
  }

  /**
   * Decode `source` (the picked file), stream it to main, and finish the
   * import. Resolves with the imported meeting's id so the caller can open it
   * in Review.
   */
  async streamFile(
    source: Blob,
    req: ImportStartRequest,
    opts: StreamFileOptions = {},
  ): Promise<string> {
    const { meetingId } = await this._api.importStart(req)

    const decoded = await this._decoder(source)
    const mono = downmixToMono(decoded.channelData)

    const framer = new PcmFramer({
      sourceSampleRate: decoded.sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
      frameSize: FRAME_SIZE,
    })

    const total = mono.length
    for (let offset = 0; offset < total; offset += CHUNK_SAMPLES) {
      const chunk = mono.subarray(offset, Math.min(offset + CHUNK_SAMPLES, total))
      framer.push(chunk, (frame) => {
        this._api.importSendFrame(frame)
      })
      opts.onProgress?.(Math.min((offset + chunk.length) / total, 1))
      if (opts.throttleMs !== undefined && opts.throttleMs > 0) {
        await delay(opts.throttleMs)
      }
    }

    // Ensure progress reaches 1 even when total is 0 (empty/edge files).
    opts.onProgress?.(1)

    await this._api.importFinish({ meetingId })
    return meetingId
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Average all channels into a single mono Float32Array. Mono passes through. */
function downmixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0]
  if (first === undefined) return new Float32Array(0)
  if (channels.length === 1) return first

  const length = first.length
  const mono = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i] ?? 0
    mono[i] = sum / channels.length
  }
  return mono
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Default decoder: decode file bytes with an OfflineAudioContext. Chromium (in
 * Electron) decodes mp3/wav/m4a/flac/ogg. Not exercised in unit tests (jsdom has
 * no Web Audio); covered by the real app.
 */
async function defaultDecoder(source: Blob): Promise<DecodedAudio> {
  // A 1-frame context is enough to call decodeAudioData; the decoded buffer
  // carries its own sample rate regardless of the context's.
  const data = await source.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE)
  const buffer = await ctx.decodeAudioData(data)
  const channelData: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channelData.push(buffer.getChannelData(c))
  }
  return { channelData, sampleRate: buffer.sampleRate }
}
