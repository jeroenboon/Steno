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
}
