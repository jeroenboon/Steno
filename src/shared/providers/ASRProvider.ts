/**
 * ASRProvider port — vendor-neutral streaming interface.
 *
 * Any implementation (Deepgram WebSocket in item 0011, local Parakeet ONNX
 * in item 0023) must satisfy this interface. The domain and extraction loop
 * depend only on this interface; no vendor types leak through.
 *
 * Streaming model:
 *   1. Call start() to open a session.
 *   2. Feed PCM audio as Uint8Array chunks via pushAudioFrame().
 *   3. Consume transcript spans via the spans() async iterator.
 *   4. Call stop() when the session ends.
 *
 * The async-iterator shape works for both WebSocket-based providers (Deepgram
 * pushes spans as they arrive) and ONNX-based providers (spans are produced
 * synchronously but surfaced the same way).
 */

import type { TranscriptSpan } from '../domain/types'

import type { AsrTerminalState } from './asrTerminalState'

export interface ASRProvider {
  /** Open a streaming session. Must be called before pushAudioFrame(). */
  start(): void

  /** Close the session. The spans() iterator completes after this is called. */
  stop(): void

  /**
   * Feed a raw PCM audio frame to the provider.
   * Frame format is provider-dependent (e.g. 16-bit LE, 16 kHz mono).
   */
  pushAudioFrame(chunk: Uint8Array): void

  /**
   * Async iterator that yields TranscriptSpans as the provider produces them.
   * Completes when stop() is called and any buffered spans have been emitted.
   */
  spans(): AsyncIterable<TranscriptSpan>

  /**
   * Transcribe a complete 16 kHz mono 16-bit LE PCM buffer in one shot and
   * resolve with all final spans, in time order.
   *
   * This is the file-import path (item 0026): the whole audio is available up
   * front, so there is no need for the streaming start()/pushAudioFrame()/spans()
   * dance. Cloud providers implement this against their prerecorded/batch API
   * (no realtime socket); local providers run their chunked inference over the
   * whole buffer.
   *
   * Optional — streaming-only providers may omit it; callers must guard with
   * `provider.transcribeBatch !== undefined`.
   */
  transcribeBatch?(pcm: Uint8Array): Promise<TranscriptSpan[]>

  /**
   * Register an observer for a permanent terminal state (audit finding C4).
   *
   * A streaming provider fires this once when its socket gives up for good — a
   * revoked/invalid key (`auth`) or the consecutive-failure ceiling
   * (`max-retries`) — right before its spans() iterator completes. The observer
   * (the runtime) surfaces it to the note-taker so a dead key does not just go
   * quiet. The callback receives ONLY the reason enum, never a key or content.
   *
   * Optional — only realtime providers with a socket can terminate; batch/local
   * providers (transcribeBatch, on-device) have no socket and simply never fire
   * it. Callers must guard with `provider.onTerminal?.(...)`.
   */
  onTerminal?(cb: (state: AsrTerminalState) => void): void
}
