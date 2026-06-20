/**
 * Tests for ModelDownloader (item 0024).
 *
 * No real network — fetch is injected and mocked.
 * No real filesystem — uses a temp dir cleaned up after each test.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  })

  // -------------------------------------------------------------------------
  // isDownloaded()
  // -------------------------------------------------------------------------

  it('isDownloaded() returns false when the model directory is empty', () => {
    const expectedFiles = makeExpectedFiles(['config.json', 'model.onnx'])
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    expect(dl.isDownloaded()).toBe(false)
  })

  it('isDownloaded() returns false when only some files are present', () => {
    const expectedFiles = makeExpectedFiles(['config.json', 'model.onnx'])
    writeFileSync(join(dir, 'config.json'), 'content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    expect(dl.isDownloaded()).toBe(false)
  })

  it('isDownloaded() returns true when all expected files are present', () => {
    const expectedFiles = makeExpectedFiles(['config.json', 'model.onnx'])
    writeFileSync(join(dir, 'config.json'), 'content')
    writeFileSync(join(dir, 'model.onnx'), 'content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    expect(dl.isDownloaded()).toBe(true)
  })

  // -------------------------------------------------------------------------
  // verify()
  // -------------------------------------------------------------------------

  it('verify() returns true when all files match their expected SHA-256', async () => {
    const content = 'expected content'
    const expectedFiles = makeExpectedFiles(['config.json'], content)
    writeFileSync(join(dir, 'config.json'), content)
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    await expect(dl.verify()).resolves.toBe(true)
  })

  it('verify() throws when a file has unexpected content (hash mismatch)', async () => {
    const expectedFiles = makeExpectedFiles(['config.json'], 'expected')
    writeFileSync(join(dir, 'config.json'), 'corrupted content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    await expect(dl.verify()).rejects.toThrow(/hash mismatch/i)
  })

  it('verify() throws when an expected file is missing', async () => {
    const expectedFiles = makeExpectedFiles(['config.json', 'model.onnx'])
    writeFileSync(join(dir, 'config.json'), 'content')
    const dl = new ModelDownloader(dir, fetch, expectedFiles)
    await expect(dl.verify()).rejects.toThrow(/missing/i)
  })

  // -------------------------------------------------------------------------
  // download()
  // -------------------------------------------------------------------------

  it('download() writes files to modelDir', async () => {
    const content = 'model content'
    const expectedFiles = makeExpectedFiles(['config.json'], content)
    const fakeFetch = makeFakeFetch(content)
    const dl = new ModelDownloader(dir, fakeFetch, expectedFiles)

    await dl.download(() => {
      return
    })

    const written = readFileSync(join(dir, 'config.json'), 'utf8')
    expect(written).toBe(content)
  })

  it('download() calls onProgress with increasing bytesReceived', async () => {
    const content = 'abcdef'
    const expectedFiles = makeExpectedFiles(['config.json'], content)
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
    const expectedFiles = makeExpectedFiles(['config.json'], content)
    // Serve different content than what the hash was computed from
    const fakeFetch = makeFakeFetch('bad content')
    const dl = new ModelDownloader(dir, fakeFetch, expectedFiles)

    await expect(
      dl.download(() => {
        return
      }),
    ).rejects.toThrow()
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
