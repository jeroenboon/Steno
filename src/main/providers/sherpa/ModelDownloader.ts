/**
 * ModelDownloader (item 0024).
 *
 * Downloads all files for the sherpa-onnx Whisper small model and verifies
 * their SHA-256 hashes.
 *
 * The small (multilingual) model is used because the bundled sherpa-onnx is the
 * 32-bit WASM build, whose heap cannot stand up a large-v3 decoder session
 * (~1.7 GB of weights). Small (~357 MB int8) fits and still handles Dutch.
 *
 * Expected files and hashes are injected at construction time so tests can use
 * controlled data without real HTTP calls. Production code uses
 * ModelDownloader.EXPECTED_FILES, which pins the authoritative SHA-256 of every
 * file (see that constant for provenance). Verification is fail-closed: a
 * mismatch removes the partial download and throws (audit C6).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { devlog } from '../../devlog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpectedFile {
  /** Filename relative to modelDir. */
  name: string
  /**
   * Expected SHA-256 hex digest. An empty string means "cannot verify": the
   * check is skipped for this file but a loud devlog warning is emitted (never a
   * silent no-op). Production EXPECTED_FILES pin real digests, so this escape
   * hatch is for tests / not-yet-pinned mirrors only.
   */
  sha256: string
}

// ---------------------------------------------------------------------------
// HuggingFace URL helper
// ---------------------------------------------------------------------------

const HF_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main'

function hfUrl(filename: string): string {
  return `${HF_BASE}/${filename}`
}

// ---------------------------------------------------------------------------
// ModelDownloader
// ---------------------------------------------------------------------------

export class ModelDownloader {
  /**
   * Expected files in the sherpa-onnx Whisper small model, with the authoritative
   * SHA-256 of each file as published by the source repo
   * (huggingface.co/csukuangfj/sherpa-onnx-whisper-small, main).
   *
   * Provenance (audit C6): the two ONNX blobs are git-LFS files, so their SHA-256
   * IS HuggingFace's LFS object id — read from the tree API and cross-checked
   * against the `X-Linked-ETag` header on the resolve endpoint. `small-tokens.txt`
   * is a non-LFS file (LFS gives no hash for it), so its digest is the SHA-256 of
   * the downloaded content (816730 bytes). Update these only alongside a matching
   * change to the upstream file — a wrong value rejects a healthy download.
   */
  static readonly EXPECTED_FILES: ExpectedFile[] = [
    {
      name: 'small-encoder.int8.onnx',
      sha256: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9',
    },
    {
      name: 'small-decoder.int8.onnx',
      sha256: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee',
    },
    {
      name: 'small-tokens.txt',
      sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    },
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
   * Files with an empty sha256 value are skipped with a loud devlog warning.
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

      if (expected.sha256 === '') {
        // Degrade, never crash: an unset expected hash means we cannot verify this
        // file. Skip it rather than blocking the model, but log loudly so it is
        // never a silent integrity no-op (audit C6).
        devlog('model', 'hash-check-skipped', { file: expected.name })
        continue
      }

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
      if (!response.ok) {
        throw new Error(
          `[ModelDownloader] Failed to download ${file.name}: ` +
            `HTTP ${String(response.status)} ${response.statusText} from ${hfUrl(file.name)}`,
        )
      }
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

    // Fail-closed integrity gate: a mismatch (or a missing file) rejects AND
    // removes every file this download wrote, so no half-written / corrupt model
    // is left on disk for sherpa to load. isDownloaded() then stays false and the
    // next attempt re-downloads cleanly.
    try {
      await this.verify()
    } catch (err) {
      this.removeAll()
      throw err
    }
  }

  /** Deletes every expected file from modelDir. Best-effort; ignores absent files. */
  private removeAll(): void {
    for (const file of this.expectedFiles) {
      rmSync(join(this.modelDir, file.name), { force: true })
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256File(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}
