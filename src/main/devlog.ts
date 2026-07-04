/**
 * Dev-only structured debug log (main process).
 *
 * A JSONL sink for diagnosing runtime behaviour (extraction turns, ASR sockets,
 * lifecycle) without a live paste-the-terminal loop. One JSON object per line so
 * it is trivial to parse and grep.
 *
 * ## Privacy (principle #12 / ADR 0003)
 * The default is METADATA-ONLY: counts, field paths, event names, timings,
 * providers, HTTP statuses. never transcript text, item text, prompts, or keys.
 * A deliberate opt-in (`--debug` / `STENO_DEBUG=1`, dev only) additionally writes
 * the `content` bucket (e.g. the actual LLM request/response) so a developer can
 * see exactly what a provider sends and returns on their OWN machine. Content is
 * NEVER written unless that opt-in is set, and the whole logger is a no-op in a
 * packaged build (it is only initialised from the dev path in index.ts).
 *
 * The sink and clock are injected (`initDevlog`), so the format is unit-tested
 * with a fake writer and never touches the filesystem in tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DevlogEntry {
  ts: string
  category: string
  event: string
  /** Non-sensitive fields — always written. */
  meta?: Record<string, unknown>
  /** Sensitive/bulky fields (prompts, responses) — written only with content mode. */
  content?: Record<string, unknown>
}

export interface DevlogConfig {
  /** Master switch. False ⇒ every devlog() call is a no-op (production). */
  enabled: boolean
  /** Opt-in (`--debug`): also write the `content` bucket. */
  includeContent: boolean
  /** Append one JSONL line. Injected (fs in production, a spy in tests). */
  write: (line: string) => void
  /** Injected clock. */
  now: () => number
  /** Per-content-field character cap so a line never runs away. Default 20000. */
  maxContentChars?: number
}

const DEFAULT_MAX_CONTENT_CHARS = 20_000

// ---------------------------------------------------------------------------
// Module state (a singleton, like console — deliberately not injected into
// every provider; uninitialised in tests so calls are no-ops)
// ---------------------------------------------------------------------------

let _config: DevlogConfig | null = null

export function initDevlog(config: DevlogConfig): void {
  _config = config
}

/** Test helper: clear the singleton between cases. */
export function resetDevlog(): void {
  _config = null
}

export function isDevlogEnabled(): boolean {
  return _config?.enabled === true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record one event. `meta` is always written; `content` only in content mode.
 * A no-op unless the logger was initialised with `enabled: true`.
 */
export function devlog(
  category: string,
  event: string,
  meta?: Record<string, unknown>,
  content?: Record<string, unknown>,
): void {
  const config = _config
  if (!config?.enabled) return

  const entry: DevlogEntry = {
    ts: new Date(config.now()).toISOString(),
    category,
    event,
    ...(meta !== undefined ? { meta } : {}),
    ...(content !== undefined ? { content } : {}),
  }

  config.write(
    formatDevlogEntry(entry, {
      includeContent: config.includeContent,
      maxContentChars: config.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
    }),
  )
}

// ---------------------------------------------------------------------------
// Pure formatting (unit-tested directly)
// ---------------------------------------------------------------------------

export interface FormatOptions {
  includeContent: boolean
  maxContentChars: number
}

export function formatDevlogEntry(entry: DevlogEntry, opts: FormatOptions): string {
  const record: Record<string, unknown> = {
    ts: entry.ts,
    category: entry.category,
    event: entry.event,
  }
  if (entry.meta !== undefined) record.meta = entry.meta
  // The content bucket is dropped entirely unless content mode is on — this is
  // the privacy guarantee: no opt-in, no content, ever.
  if (opts.includeContent && entry.content !== undefined) {
    record.content = truncateContent(entry.content, opts.maxContentChars)
  }
  return JSON.stringify(record)
}

/** Cap each string field so one huge payload can't blow up a line. */
function truncateContent(content: Record<string, unknown>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'string' && value.length > max) {
      out[key] = `${value.slice(0, max)}…[+${String(value.length - max)} chars]`
    } else {
      out[key] = value
    }
  }
  return out
}
