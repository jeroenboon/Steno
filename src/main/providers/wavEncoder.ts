/**
 * Minimal WAV (RIFF/PCM) encoder for the batch ASR import path.
 *
 * The renderer decodes uploaded audio to raw 16 kHz mono 16-bit LE PCM and
 * streams it to main. Cloud transcription endpoints (OpenAI, Mistral, Azure
 * Whisper) take a recognised container, not headerless PCM, so the batch ASR
 * adapters wrap the PCM in a WAV header before upload. Pure and dependency-free
 * so it lives next to the adapters that share it.
 */

const PCM_FORMAT = 1
const BITS_PER_SAMPLE = 16

export interface WavOptions {
  sampleRate: number
  channels: number
}

/**
 * Wrap raw 16-bit LE PCM in a 44-byte canonical WAV header.
 *
 * @param pcm     - Raw 16-bit little-endian PCM samples.
 * @param options - Sample rate (e.g. 16000) and channel count (e.g. 1).
 */
export function encodeWav(pcm: Uint8Array, options: WavOptions): Uint8Array {
  const { sampleRate, channels } = options
  const blockAlign = (channels * BITS_PER_SAMPLE) / 8
  const byteRate = sampleRate * blockAlign
  const dataLen = pcm.length

  const buffer = new ArrayBuffer(44 + dataLen)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true) // chunk size
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // subchunk1 size (PCM)
  view.setUint16(20, PCM_FORMAT, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLen, true)

  const out = new Uint8Array(buffer)
  out.set(pcm, 44)
  return out
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}
