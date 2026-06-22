/**
 * DefaultSherpaSessionFactory — wraps sherpa-onnx at runtime.
 *
 * This file is ONLY loaded when local ASR is actually used (lazy import from
 * LocalAsrProvider). Tests inject FakeSherpaSessionFactory and never reach here.
 *
 * sherpa-onnx is a native module that requires ABI-matching via
 * rebuild-native.mjs (same dual-ABI pattern as better-sqlite3). See CLAUDE.md.
 *
 * Uses the OfflineRecognizer API (batch-per-chunk, no token streaming).
 * Per ADR 0011: each chunk yields one span without isFinal, treated as final.
 */

import { join } from 'node:path'

import type { SherpaSession, SherpaSessionFactory } from './SherpaSession'

export class DefaultSherpaSessionFactory implements SherpaSessionFactory {
  constructor(private readonly language = 'nl') {}

  async createSession(modelDir: string): Promise<SherpaSession> {
    // Dynamic import — keeps sherpa-onnx out of the module graph for tests
    // and avoids a load-time crash when the package is not installed.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sherpa = await import('sherpa-onnx')

    const encoder = join(modelDir, 'small-encoder.int8.onnx')
    const decoder = join(modelDir, 'small-decoder.int8.onnx')
    const tokens = join(modelDir, 'small-tokens.txt')

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const recognizer = sherpa.createOfflineRecognizer({
      modelConfig: {
        whisper: {
          encoder,
          decoder,
          language: this.language,
          task: 'transcribe',
        },
        tokens,
        numThreads: 2,
        debug: 0,
        provider: 'cpu',
      },
    })

    return new SherpaOfflineSession(recognizer)
  }
}

class SherpaOfflineSession implements SherpaSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly recognizer: any) {}

  transcribe(audioPcm: Float32Array, sampleRate: number): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const stream = this.recognizer.createStream()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    stream.acceptWaveform(sampleRate, audioPcm)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.recognizer.decode(stream)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = this.recognizer.getResult(stream)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    stream.free()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return Promise.resolve(typeof result.text === 'string' ? result.text : '')
  }

  free(): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.recognizer.free?.()
  }
}
