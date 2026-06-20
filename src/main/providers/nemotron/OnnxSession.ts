/**
 * ONNX session port — hides onnxruntime-genai behind a typed interface.
 *
 * The real DefaultOnnxSessionFactory wraps onnxruntime-genai at runtime.
 * Tests inject FakeOnnxSessionFactory with scripted transcriptions.
 */

// ---------------------------------------------------------------------------
// Domain interface
// ---------------------------------------------------------------------------

export interface OnnxSession {
  /**
   * Transcribe a PCM audio chunk.
   * Audio is Float32, 16 kHz mono, normalised to [-1, 1].
   * Returns an async iterable that yields text tokens as they arrive.
   */
  transcribe(audioPcm: Float32Array, chunkMs: number): AsyncIterable<string>
}

export interface OnnxSessionFactory {
  /** Create and initialise a session from the model directory. */
  createSession(modelDir: string, executionProviders: string[]): Promise<OnnxSession>
}

// ---------------------------------------------------------------------------
// FakeOnnxSessionFactory (test double)
// ---------------------------------------------------------------------------

/**
 * Returns scripted text for each chunk in order.
 * When the script runs out, subsequent chunks return an empty string.
 */
export class FakeOnnxSession implements OnnxSession {
  private index = 0

  constructor(private readonly script: string[]) {}

  async *transcribe(audioPcm: Float32Array, chunkMs: number): AsyncIterable<string> {
    void audioPcm
    void chunkMs
    await Promise.resolve()
    const text = this.script[this.index] ?? ''
    this.index++
    if (text.length > 0) yield text
  }
}

export class FakeOnnxSessionFactory implements OnnxSessionFactory {
  constructor(private readonly script: string[] = []) {}

  createSession(modelDir: string, eps: string[]): Promise<OnnxSession> {
    void modelDir
    void eps
    return Promise.resolve(new FakeOnnxSession(this.script))
  }
}
