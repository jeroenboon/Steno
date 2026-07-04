/**
 * @vitest-environment node
 *
 * Tests for the dev-only debug log. The sink + clock are injected, so nothing
 * touches the filesystem. The privacy guarantee — no content unless the opt-in
 * is set — is asserted directly.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  devlog,
  formatDevlogEntry,
  initDevlog,
  isDevlogEnabled,
  resetDevlog,
  type DevlogConfig,
} from './devlog'

afterEach(() => {
  resetDevlog()
})

interface ParsedLine {
  ts: string
  category: string
  event: string
  meta?: Record<string, unknown>
  content?: Record<string, string>
}

function parse(line: string | undefined): ParsedLine {
  return JSON.parse(line ?? '{}') as ParsedLine
}

function collector(over: Partial<DevlogConfig> = {}): { lines: string[]; config: DevlogConfig } {
  const lines: string[] = []
  const config: DevlogConfig = {
    enabled: true,
    includeContent: false,
    write: (line) => lines.push(line),
    now: () => 0,
    ...over,
  }
  return { lines, config }
}

describe('formatDevlogEntry', () => {
  const entry = {
    ts: '1970-01-01T00:00:00.000Z',
    category: 'extraction',
    event: 'turn',
    meta: { decisions: '0/3', dropped: ['decision.rationale'] },
    content: { request: 'geheime transcripttekst', response: '{"proposedDecisions":[]}' },
  }

  it('always includes ts, category, event and meta', () => {
    const parsed = parse(formatDevlogEntry(entry, { includeContent: false, maxContentChars: 100 }))
    expect(parsed).toMatchObject({
      ts: entry.ts,
      category: 'extraction',
      event: 'turn',
      meta: { decisions: '0/3' },
    })
  })

  it('omits the content bucket entirely when content mode is off', () => {
    const line = formatDevlogEntry(entry, { includeContent: false, maxContentChars: 100 })
    expect(line).not.toContain('geheime transcripttekst')
    expect(parse(line)).not.toHaveProperty('content')
  })

  it('includes the content bucket when content mode is on', () => {
    const parsed = parse(formatDevlogEntry(entry, { includeContent: true, maxContentChars: 100 }))
    expect(parsed.content?.request).toBe('geheime transcripttekst')
  })

  it('truncates long content strings to the cap', () => {
    const long = { content: { blob: 'x'.repeat(50) } }
    const parsed = parse(
      formatDevlogEntry(
        { ts: 't', category: 'c', event: 'e', ...long },
        { includeContent: true, maxContentChars: 10 },
      ),
    )
    expect(parsed.content?.blob).toBe(`${'x'.repeat(10)}…[+40 chars]`)
  })
})

describe('devlog()', () => {
  it('is a no-op before initialisation', () => {
    expect(isDevlogEnabled()).toBe(false)
    expect(() => {
      devlog('extraction', 'turn', { a: 1 })
    }).not.toThrow()
  })

  it('is a no-op when disabled', () => {
    const { lines, config } = collector({ enabled: false })
    initDevlog(config)
    devlog('extraction', 'turn', { a: 1 })
    expect(lines).toHaveLength(0)
  })

  it('writes one JSONL line per call with meta, no content by default', () => {
    const { lines, config } = collector()
    initDevlog(config)
    devlog('asr', 'socket-open', { vendor: 'deepgram' }, { url: 'wss://secret' })
    expect(lines).toHaveLength(1)
    const parsed = parse(lines[0])
    expect(parsed).toMatchObject({ category: 'asr', event: 'socket-open', meta: { vendor: 'deepgram' } })
    expect(lines[0]).not.toContain('wss://secret')
  })

  it('writes the content bucket when initialised with includeContent', () => {
    const { lines, config } = collector({ includeContent: true })
    initDevlog(config)
    devlog('extraction', 'turn', { decisions: '0/0' }, { response: 'raw-json' })
    expect(parse(lines[0]).content?.response).toBe('raw-json')
  })
})
