/**
 * DefaultOnnxSessionFactory — wraps onnxruntime-genai at runtime.
 *
 * This file is ONLY loaded when local ASR is actually used (lazy import from
 * LocalAsrProvider). Tests inject FakeOnnxSessionFactory and never reach here.
 *
 * onnxruntime-genai is a native module that requires ABI-matching via
 * rebuild-native.mjs (same dual-ABI pattern as better-sqlite3). See CLAUDE.md.
 *
 * NOTE: The onnxruntime-genai Node.js API is still evolving. The implementation
 * below reflects the expected API based on the package's documentation. Adjust
 * after the spike confirms the exact method signatures on the installed version.
 */

import type { OnnxSession, OnnxSessionFactory } from './OnnxSession'

export class DefaultOnnxSessionFactory implements OnnxSessionFactory {
  async createSession(modelDir: string, executionProviders: string[]): Promise<OnnxSession> {
    // Dynamic import keeps onnxruntime-genai out of the module graph for tests
    // and avoids a load-time crash when the package is not installed.
    // @ts-expect-error TS2307 — optional native module, not present until first use
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const ort = await import('onnxruntime-genai')

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const model = await ort.Model.create(modelDir, { executionProviders })

    return new OnnxRnntSession(model)
  }
}

class OnnxRnntSession implements OnnxSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly model: any) {}

  async *transcribe(audioPcm: Float32Array, chunkMs: number): AsyncIterable<string> {
    void chunkMs
    // NOTE: the exact onnxruntime-genai streaming API needs to be verified
    // during the spike. The code below is a placeholder that matches the
    // expected API based on the model card.
    //
    // Expected flow:
    //   1. Create an audio stream from the Float32Array
    //   2. Run the RNNT encoder on the chunk
    //   3. Feed encoder output through the joint network + decoder
    //   4. Yield text tokens as they are produced
    //
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const generator = await this.model.generate({ audio: audioPcm })
    for await (const token of generator) {
      yield String(token)
    }
  }
}
