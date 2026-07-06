/**
 * @vitest-environment node
 *
 * Tests for the process-level error backstop (audit finding C3).
 *
 * A stray unhandled promise rejection must never silently take the app down
 * mid-meeting. The backstop logs it via the project devlog. The devlog sink is
 * injected so nothing touches the filesystem.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { initDevlog, resetDevlog, type DevlogConfig } from './devlog'
import { installProcessErrorHandlers, logUnhandledRejection } from './processErrorHandlers'

afterEach(() => {
  resetDevlog()
})

interface ParsedLine {
  category: string
  event: string
  meta?: Record<string, unknown>
}

function collector(): { lines: string[]; config: DevlogConfig } {
  const lines: string[] = []
  const config: DevlogConfig = {
    enabled: true,
    includeContent: false,
    write: (line) => lines.push(line),
    now: () => 0,
  }
  return { lines, config }
}

function parse(line: string | undefined): ParsedLine {
  return JSON.parse(line ?? '{}') as ParsedLine
}

describe('logUnhandledRejection', () => {
  it('logs an Error reason via devlog with the app/unhandled-rejection tag', () => {
    const { lines, config } = collector()
    initDevlog(config)

    logUnhandledRejection(new Error('db insert failed'))

    expect(lines).toHaveLength(1)
    const parsed = parse(lines[0])
    expect(parsed.category).toBe('app')
    expect(parsed.event).toBe('unhandled-rejection')
    expect(parsed.meta?.reason).toBe('db insert failed')
  })

  it('stringifies a non-Error reason', () => {
    const { lines, config } = collector()
    initDevlog(config)

    logUnhandledRejection('boom')

    expect(parse(lines[0]).meta?.reason).toBe('boom')
  })

  it('is a no-op when devlog is uninitialised (production)', () => {
    expect(() => {
      logUnhandledRejection(new Error('x'))
    }).not.toThrow()
  })
})

describe('installProcessErrorHandlers', () => {
  it('registers a process unhandledRejection listener that logs the reason', () => {
    const before = process.listeners('unhandledRejection')
    const { lines, config } = collector()
    initDevlog(config)

    installProcessErrorHandlers()

    const added = process.listeners('unhandledRejection').filter((l) => !before.includes(l))
    try {
      expect(added).toHaveLength(1)

      // Drive the listener the way Node would on a real stray rejection.
      process.emit('unhandledRejection', new Error('stray'), Promise.resolve())

      const logged = lines.map(parse).filter((p) => p.event === 'unhandled-rejection')
      expect(logged).toHaveLength(1)
      expect(logged[0]?.meta?.reason).toBe('stray')
    } finally {
      for (const l of added) {
        process.off('unhandledRejection', l as (...args: unknown[]) => void)
      }
    }
  })
})
