/**
 * ModelDownloader (item 0024).
 *
 * Downloads all files for the nemotron-3.5-asr-streaming-0.6b-int4 model from
 * HuggingFace and verifies their SHA-256 hashes.
 *
 * Expected files and hashes are injected at construction time so tests can use
 * controlled data without real HTTP calls. Production code uses
 * ModelDownloader.EXPECTED_FILES. Hashes will be filled in after the spike.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpectedFile {
  /** Filename relative to modelDir. */
  name: string
  /**
   * Expected SHA-256 hex digest. Empty string means "skip hash check" —
   * used as a placeholder until the spike produces real hashes.
   */
  sha256: string
}

// ---------------------------------------------------------------------------
// HuggingFace URL helper
// ---------------------------------------------------------------------------

const HF_BASE =
  'https://huggingface.co/onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4/resolve/main'

function hfUrl(filename: string): string {
  return `${HF_BASE}/${filename}`
}

// ---------------------------------------------------------------------------
// ModelDownloader
// ---------------------------------------------------------------------------

export class ModelDownloader {
  /**
   * Expected files in the nemotron-3.5-asr-streaming-0.6b-int4 model.
   *
   * NOTE: sha256 values are placeholders ('') until the spike is completed on
   * the target hardware. Fill them in after running scripts/spike-local-asr.mjs
   * and verifying the downloads.
   */
  static readonly EXPECTED_FILES: ExpectedFile[] = [
    { name: 'config.json', sha256: '' },
    { name: 'tokenizer.json', sha256: '' },
    { name: 'model.onnx', sha256: '' },
  ]

  constructor(
    private readonly modelDir: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly expectedFiles: ExpectedFile[] = ModelDownloader.EXPECTED_FILES,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Returns true if all expected files are present in modelDir. */
  isDownloaded(): boolean {
    return this.expectedFiles.every((f) => existsSync(join(this.modelDir, f.name)))
  }

  /**
   * Verifies each expected file by comparing its SHA-256 to the stored hash.
   * Files with an empty sha256 value are skipped (spike pending).
   * Throws if a file is missing or its hash does not match.
   */
  verify(): Promise<boolean> {
    for (const expected of this.expectedFiles) {
      const filePath = join(this.modelDir, expected.name)
      if (!existsSync(filePath)) {
        return Promise.reject(
          new Error(`[ModelDownloader] Missing expected file: ${expected.name}`),
        )
      }

      if (expected.sha256 === '') continue

      const actual = sha256File(filePath)
      if (actual !== expected.sha256) {
        return Promise.reject(
          new Error(
            `[ModelDownloader] Hash mismatch for ${expected.name}: ` +
              `expected ${expected.sha256}, got ${actual}`,
          ),
        )
      }
    }
    return Promise.resolve(true)
  }

  /**
   * Downloads all expected files from HuggingFace.
   * Reports aggregated progress via onProgress(bytesReceived, bytesTotal).
   * Runs verify() after all downloads complete; throws if any hash fails.
   */
  async download(onProgress: (received: number, total: number) => void): Promise<void> {
    mkdirSync(this.modelDir, { recursive: true })

    // Two-pass: first HEAD all files to get total size, then download.
    // For simplicity we use the content-length from each GET response.
    // We accumulate a global byte counter across all files.

    let totalBytes = 0
    let receivedBytes = 0

    // --- Phase 1: fetch all, accumulate ---
    const responses: { file: ExpectedFile; response: Response }[] = []
    for (const file of this.expectedFiles) {
      const response = await this.fetcher(hfUrl(file.name))
      responses.push({ file, response })
      const cl = response.headers.get('content-length')
      if (cl !== null) {
        totalBytes += parseInt(cl, 10)
      }
    }

    // --- Phase 2: stream each response to disk ---
    for (const { file, response } of responses) {
      const filePath = join(this.modelDir, file.name)
      const chunks: Uint8Array[] = []

      if (!response.body) {
        throw new Error(`[ModelDownloader] No response body for ${file.name}`)
      }
      const reader = response.body.getReader()

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        receivedBytes += value.byteLength
        onProgress(receivedBytes, Math.max(totalBytes, receivedBytes))
      }

      const buffer = Buffer.concat(chunks)
      await writeFile(filePath, buffer)
    }

    // Final progress callback to ensure we report 100%
    if (totalBytes > 0) {
      onProgress(totalBytes, totalBytes)
    }

    await this.verify()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256File(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}
