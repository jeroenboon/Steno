/**
 * Test-only console capture.
 *
 * Several code paths log an expected, fully-handled error at runtime (an LLM
 * returned junk and the turn was skipped, a provider socket was rejected, a
 * transcription HTTP call failed). Those logs are *desirable* in the running
 * app — a real operator wants to see them — but in a green test run they scroll
 * past as stderr noise and train people to ignore output (audit 04-tests Q3).
 *
 * This helper lets an expected-error test do the right thing: spy on the console
 * method, keep the output OUT of the terminal, and still assert the log fired so
 * the error path stays covered. Restore with the returned handle (typically in a
 * `finally` or `afterEach`).
 *
 * It imports `vitest`, so it lives here rather than in production source and is
 * only ever pulled in by `*.test.ts(x)` files.
 */
import { expect, vi } from 'vitest'

type ConsoleMethod = 'error' | 'warn' | 'log' | 'info' | 'debug'

export interface CapturedConsole {
  /** Every captured call, args stringified and space-joined, in order. */
  readonly lines: string[]
  /** All captured lines joined with newlines (convenient for `toContain`). */
  text(): string
  /** Assert some captured line contains each needle (keeps the path covered). */
  expectLogged(...needles: string[]): void
  /** Restore the spied console methods. Call once, when the test is done. */
  restore(): void
}

/**
 * Spy on the given console methods (default: `error` + `warn`), suppressing their
 * output while capturing it for assertions.
 */
export function captureConsole(...methods: ConsoleMethod[]): CapturedConsole {
  const targets: ConsoleMethod[] = methods.length > 0 ? methods : ['error', 'warn']
  const lines: string[] = []
  const spies = targets.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }),
  )

  return {
    lines,
    text: () => lines.join('\n'),
    expectLogged(...needles: string[]) {
      const text = lines.join('\n')
      for (const needle of needles) expect(text).toContain(needle)
    },
    restore() {
      for (const spy of spies) spy.mockRestore()
    },
  }
}
