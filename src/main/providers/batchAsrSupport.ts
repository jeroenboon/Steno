/**
 * Shared substrate for import-only (batch) ASR adapters (Phase 3).
 *
 * OpenAI, Mistral Voxtral and Azure Whisper all transcribe an uploaded file by
 * POSTing a WAV multipart form to an /audio/transcriptions-style endpoint. They
 * differ only in the URL + auth header (captured by AudioBatchTarget) and the
 * response shape (each adapter applies its own Zod schema + span mapping). The
 * common work — WAV encoding, multipart assembly, the POST, and HTTP-error
 * handling — lives here so the adapters stay thin.
 *
 * Live ASR for these vendors has no shared realtime wire and is a later phase,
 * so ImportOnlyAsrProvider implements the streaming methods as "not yet
 * implemented" throws; subclasses implement only transcribeBatch.
 *
 * ## Privacy (principle #12)
 * Auth lives only in `target.headers`; it is never logged. Audio and transcript
 * text are never logged — only the non-sensitive log tag and HTTP status.
 */

import type { TranscriptSpan } from '@shared/domain/types'
import type { ASRProvider } from '@shared/providers'

import { encodeWav } from './wavEncoder'

const SAMPLE_RATE = 16_000
const CHANNELS = 1

/** Resolved endpoint URL + request headers (carries the auth header). */
export interface AudioBatchTarget {
  url: string
  headers: Record<string, string>
}

export interface PostAudioTranscriptionOptions {
  /** Raw 16 kHz mono 16-bit LE PCM from the renderer. */
  pcm: Uint8Array
  /** Non-file multipart fields, e.g. { model, response_format, language }. */
  formFields: Record<string, string>
  /** Resolved URL + headers. */
  target: AudioBatchTarget
  /** Non-sensitive log tag, e.g. `[OpenAI audio]`. */
  logTag: string
  /** Injected for testability. */
  fetch: typeof globalThis.fetch
}

/**
 * WAV-encode the PCM, post it as multipart/form-data, and return the parsed JSON
 * response. Throws on a non-ok HTTP response so the import surfaces the failure
 * instead of silently producing an empty transcript.
 */
export async function postAudioTranscription(
  opts: PostAudioTranscriptionOptions,
): Promise<unknown> {
  const wav = encodeWav(opts.pcm, { sampleRate: SAMPLE_RATE, channels: CHANNELS })

  const form = new FormData()
  for (const [key, value] of Object.entries(opts.formFields)) {
    form.append(key, value)
  }
  form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'audio.wav')

  const response = await opts.fetch(opts.target.url, {
    method: 'POST',
    headers: opts.target.headers,
    body: form,
  })

  if (!response.ok) {
    console.error(`${opts.logTag} Transcription request failed (HTTP ${String(response.status)})`)
    throw new Error(`Transcription request failed with status ${String(response.status)}`)
  }

  return response.json()
}

/**
 * Base class for ASR adapters that only support file import. Implements the
 * streaming half of ASRProvider as descriptive throws; subclasses implement
 * transcribeBatch. The factory gates selecting such a provider for a live
 * meeting (Phase 3.4), but these throws are the last line of defence.
 */
export abstract class ImportOnlyAsrProvider implements ASRProvider {
  protected constructor(protected readonly logTag: string) {}

  abstract transcribeBatch(pcm: Uint8Array): Promise<TranscriptSpan[]>

  start(): never {
    throw new Error(this._liveNotImplemented())
  }

  stop(): void {
    // No streaming session to close; safe no-op so cleanup paths don't throw.
  }

  pushAudioFrame(): never {
    throw new Error(this._liveNotImplemented())
  }

  spans(): never {
    throw new Error(this._liveNotImplemented())
  }

  private _liveNotImplemented(): string {
    return `${this.logTag} live streaming ASR is not yet implemented; this provider supports file import only.`
  }
}
