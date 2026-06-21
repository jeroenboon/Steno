/**
 * sherpa-onnx session port — hides the native addon behind a typed interface.
 *
 * The real DefaultSherpaSessionFactory wraps sherpa-onnx at runtime.
 * Tests inject FakeSherpaSessionFactory with scripted transcriptions.
 */

// ---------------------------------------------------------------------------
// Domain interface
// ---------------------------------------------------------------------------

export interface SherpaSession {
  /**
   * Transcribe a PCM audio chunk.
   * Audio is Float32, 16 kHz mono, normalised to [-1, 1].
   * Returns the decoded text for this chunk.
   */
  transcribe(audioPcm: Float32Array, sampleRate: number): Promise<string>
  /** Release native resources. */
  free(): void
}

export interface SherpaSessionFactory {
  /** Create and initialise a session from the model directory. */
  createSession(modelDir: string): Promise<SherpaSession>
}

// ---------------------------------------------------------------------------
// FakeSherpaSessionFactory (test double)
// ---------------------------------------------------------------------------

/**
 * Returns scripted text for each chunk in order.
 * When the script runs out, subsequent chunks return an empty string.
 */
export class FakeSherpaSession implements SherpaSession {
  private index = 0

  constructor(private readonly script: string[]) {}

  transcribe(audioPcm: Float32Array, sampleRate: number): Promise<string> {
    void audioPcm
    void sampleRate
    const text = this.script[this.index] ?? ''
    this.index++
    return Promise.resolve(text)
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  free(): void {}
}

export class FakeSherpaSessionFactory implements SherpaSessionFactory {
  constructor(private readonly script: string[] = []) {}

  createSession(modelDir: string): Promise<SherpaSession> {
    void modelDir
    return Promise.resolve(new FakeSherpaSession(this.script))
  }
}
