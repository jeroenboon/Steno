/**
 * Tests for ModelDownloader (item 0024).
 *
 * No real network — fetch is injected and mocked.
 * No real filesystem — uses a temp dir cleaned up after each test.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initDevlog, resetDevlog, type DevlogEntry } from '../../devlog'

import { ModelDownloader, type ExpectedFile } from './ModelDownloader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: Buffer | string): string {
  return createHash('sha256')
    .update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
    .digest('hex')
}

/** Minimal set of test-controlled expected files (no real hashes needed). */
function makeExpectedFiles(names: string[], content = 'content'): ExpectedFile[] {
  return names.map((name) => ({
    name,
    sha256: sha256(content),
  }))
}

function makeTestDir(): string {
  const dir = join(tmpdir(), `model-downloader-test-${String(Date.now())}-${String(Math.random())}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Build a fake fetch that returns the given content for every request. */
function makeFakeFetch(
  content: string,
  opts: { totalBytes?: number; chunkCount?: number } = {},
): typeof fetch {
  const totalBytes = opts.totalBytes ?? Buffer.byteLength(content, 'utf8')
  const chunkCount = opts.chunkCount ?? 1
  const chunkSize = Math.ceil(totalBytes / chunkCount)

  const fn = (_url: string | URL | Request): Promise<Response> => {
    void _url
    const encoded = Buffer.from(content, 'utf8')
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= encoded.length) {
          controller.close()
          return
        }
        const chunk = encoded.subarray(offset, Math.min(offset + chunkSize, encoded.length))
        controller.enqueue(chunk)
        offset += chunkSize
      },
    })
    return Promise.resolve(
      new Response(stream, {
        headers: { 'content-length': String(totalBytes) },
      }),
    )
  }
  return vi.fn(fn)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelDownloader', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTestDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetDevlog()
  })

  /** Capture devlog lines with a fake writer (no filesystem, no real clock). */
  function startDevlog(): DevlogEntry[] {
    const lines: DevlogEntry[] = []
    initDevlog({
      enabled: true,
      includeContent: false,
      write: (line) => lines.push(JSON.parse(line) as DevlogEntry),
      now: () => 0,
    })
    return lines
  }

  // -------------------------------------------------------------------------
  // EXPECTED_FILES
  // -------------------------------------------------------------------------

  it('EXPECTED_FILES match the filenames published in the HuggingFace repo', () => {
    // These names double as the remote download path AND the local filename, so
    // they must match csukuangfj/sherpa-onnx-whisper-small exactly. Getting a
    // name wrong 404s and the error-page body gets saved as the model file
    // (that is how tokens.txt once became 15 bytes of "Entry not found").
    const names = ModelDownloader.EXPECTED_FILES.map((f) => f.name)
    expect(names).toEqual([
      'small-encoder.int8.onnx',
      'small-decoder.int8.onnx',
      'small-tokens.txt',
    ])
  })

  it('EXPECTED_FILES pin the authoritative SHA-256 published on HuggingFace', () => {
    // Real integrity gate (audit C6): these are the SHA-256 of the exact files in
    // csukuangfj/sherpa-onnx-whisper-small (HF git-LFS OID / X-Linked-ETag for the
    // two ONNX blobs; hashed content for the non-LFS tokens file). A wrong value
    // here breaks the download for every user, so they are cross-verified, not
    // guessed. Empty strings are forbidden — that was the no-op the audit flagged.
    const byName = new Map(ModelDownloader.EXPECTED_FILES.map((f) => [f.name, f.sha256]))
    expect(byName.get('small-encoder.int8.onnx')).toBe(
      '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9',
    )
    expect(byName.get('small-decoder.int8.onnx')).toBe(
      'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee',
    )
    expect(byName.get('small-tokens.txt')).toBe(
      'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    )
    // No entry may regress to an empty (unverifiable) hash.
    for (const f of ModelDownloader.EXPECTED_FILES) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  // -------------------------------------------------------------------------
  // isDownloaded()
  // -------------------------------------------------------------------------

  it('isDownloaded() returns false when the model directory is empty', () => {
    const expectedFiles = makeExpectedFiles(['small-encoder.int8.onnx', 'tokens.txt'])
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    expect(dl.isDownloaded()).toBe(false)
  })

  it('isDownloaded() returns false when only some files are present', () => {
    const expectedFiles = makeExpectedFiles(['small-encoder.int8.onnx', 'tokens.txt'])
    writeFileSync(join(dir, 'small-encoder.int8.onnx'), 'content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    expect(dl.isDownloaded()).toBe(false)
  })

  it('isDownloaded() returns true when all expected files are present', () => {
    const expectedFiles = makeExpectedFiles(['small-encoder.int8.onnx', 'tokens.txt'])
    writeFileSync(join(dir, 'small-encoder.int8.onnx'), 'content')
    writeFileSync(join(dir, 'tokens.txt'), 'content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    expect(dl.isDownloaded()).toBe(true)
  })

  // -------------------------------------------------------------------------
  // verify()
  // -------------------------------------------------------------------------

  it('verify() returns true when all files match their expected SHA-256', async () => {
    const content = 'expected content'
    const expectedFiles = makeExpectedFiles(['tokens.txt'], content)
    writeFileSync(join(dir, 'tokens.txt'), content)
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    await expect(dl.verify()).resolves.toBe(true)
  })

  it('verify() throws when a file has unexpected content (hash mismatch)', async () => {
    const expectedFiles = makeExpectedFiles(['tokens.txt'], 'expected')
    writeFileSync(join(dir, 'tokens.txt'), 'corrupted content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    await expect(dl.verify()).rejects.toThrow(/hash mismatch/i)
  })

  it('verify() skips an empty expected hash but emits a loud devlog warning', async () => {
    // Policy (degrade, never crash): an unset hash means "we cannot verify this
    // file". We do NOT hard-fail (a missing hash must never block the app from
    // getting a model), but we DO surface it loudly so it is never a silent no-op.
    const lines = startDevlog()
    const expectedFiles: ExpectedFile[] = [{ name: 'small-tokens.txt', sha256: '' }]
    writeFileSync(join(dir, 'small-tokens.txt'), 'anything at all')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)

    await expect(dl.verify()).resolves.toBe(true)

    const warning = lines.find((l) => l.event === 'hash-check-skipped')
    expect(warning).toBeDefined()
    expect(warning?.meta?.file).toBe('small-tokens.txt')
  })

  it('verify() throws when an expected file is missing', async () => {
    const expectedFiles = makeExpectedFiles(['small-encoder.int8.onnx', 'tokens.txt'])
    writeFileSync(join(dir, 'small-encoder.int8.onnx'), 'content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    await expect(dl.verify()).rejects.toThrow(/missing/i)
  })

  // -------------------------------------------------------------------------
  // download()
  // -------------------------------------------------------------------------

  it('download() writes files to modelDir', async () => {
    const content = 'model content'
    const expectedFiles = makeExpectedFiles(['tokens.txt'], content)
    const fakeFetch = makeFakeFetch(content)
    const dl = new ModelDownloader(dir, fakeFetch, expectedFiles)

    await dl.download(() => {
      return
    })

    const written = readFileSync(join(dir, 'tokens.txt'), 'utf8')
    expect(written).toBe(content)
  })

  it('download() calls onProgress with increasing bytesReceived', async () => {
    const content = 'abcdef'
    const expectedFiles = makeExpectedFiles(['tokens.txt'], content)
    const fakeFetch = makeFakeFetch(content, { chunkCount: 3 })
    const dl = new ModelDownloader(dir, fakeFetch, expectedFiles)

    const progressCalls: { received: number; total: number }[] = []
    await dl.download((received, total) => {
      progressCalls.push({ received, total })
    })

    expect(progressCalls.length).toBeGreaterThan(0)
    // Progress is non-decreasing
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i]?.received).toBeGreaterThanOrEqual(progressCalls[i - 1]?.received ?? 0)
    }
    // Final call reaches total
    const last = progressCalls[progressCalls.length - 1]
    expect(last?.received).toBe(last?.total)
  })

  it('download() throws when verify fails after download (corrupt content)', async () => {
    const content = 'good content'
    const expectedFiles = makeExpectedFiles(['tokens.txt'], content)
    // Serve different content than what the hash was computed from
    const fakeFetch = makeFakeFetch('bad content')
    const dl = new ModelDownloader(dir, fakeFetch, expectedFiles)

    await expect(
      dl.download(() => {
        return
      }),
    ).rejects.toThrow()
  })

  it('download() removes the corrupt files it wrote when verify fails', async () => {
    // Fail-closed: a hash mismatch must reject AND leave no half-written model on
    // disk. Otherwise isDownloaded() reports true over corrupt bytes and sherpa
    // loads garbage instead of re-downloading.
    const content = 'good content'
    const expectedFiles = makeExpectedFiles(
      ['small-encoder.int8.onnx', 'small-tokens.txt'],
      content,
    )
    const fakeFetch = makeFakeFetch('bad content')
    const dl = new ModelDownloader(dir, fakeFetch, expectedFiles)

    await expect(
      dl.download(() => {
        return
      }),
    ).rejects.toThrow(/hash mismatch/i)

    expect(existsSync(join(dir, 'small-encoder.int8.onnx'))).toBe(false)
    expect(existsSync(join(dir, 'small-tokens.txt'))).toBe(false)
    expect(dl.isDownloaded()).toBe(false)
  })

  it('download() rejects and writes nothing when the server responds non-OK', async () => {
    // A 404 from HuggingFace returns a small "Entry not found" body. Without an
    // ok-check that body gets written as if it were the model file — exactly how
    // tokens.txt ended up as 15 bytes of garbage and sherpa's ReadTokens failed.
    const expectedFiles = makeExpectedFiles(['small-tokens.txt'])
    const notFoundFetch = vi.fn((): Promise<Response> =>
      Promise.resolve(new Response('Entry not found', { status: 404 })),
    ) as unknown as typeof fetch
    const dl = new ModelDownloader(dir, notFoundFetch, expectedFiles)

    await expect(
      dl.download(() => {
        return
      }),
    ).rejects.toThrow(/404|not found/i)

    expect(existsSync(join(dir, 'small-tokens.txt'))).toBe(false)
  })

  it('download() creates modelDir if it does not exist', async () => {
    const content = 'x'
    const expectedFiles = makeExpectedFiles(['f.json'], content)
    const fakeFetch = makeFakeFetch(content)
    const subDir = join(dir, 'new', 'nested')
    const dl = new ModelDownloader(subDir, fakeFetch, expectedFiles)
    await dl.download(() => {
      return
    })
    const written = readFileSync(join(subDir, 'f.json'), 'utf8')
    expect(written).toBe(content)
  })
})
