/**
 * OpenAI-compatible transport wire for the ExtractionEngine (ADR 0034).
 *
 * OpenAI, Mistral, Azure OpenAI and any BYO OpenAI-compatible endpoint all speak
 * the same `chat/completions` wire. Cloud vendors use JSON mode
 * (`response_format: { type: "json_object" }`); local runtimes send
 * `{ type: "text" }` because newer LM Studio 400s on `json_object` (see the
 * `responseFormat` option). They otherwise differ only in the request URL and the
 * auth header (OpenAI/Mistral use `Authorization: Bearer`, Azure uses `api-key`).
 * Those differences are captured by the injected `ChatCompletionsTarget`.
 *
 * This wire owns everything transport-specific: building the chat-completions
 * body, the stable `prompt_cache_key`, the POST, pulling the message content out
 * of the response, and the tolerant `parseJsonLoose` that recovers a JSON object
 * from an endpoint that ignores json_object mode (markdown fences / prose). It
 * returns a parsed candidate object, or null on a transport/HTTP/parse failure;
 * the engine coerces and validates.
 *
 * ## Privacy (principle #12)
 * The API key only ever appears inside the injected `target.headers`; it is never
 * logged. Logs carry the non-sensitive `logTag` (e.g. `[OpenAI]`, `[Azure]`).
 */

import {
  ExtractionTruncatedError,
  type ExtractionCall,
  type ExtractionWire,
} from './extractionEngine'

// ---------------------------------------------------------------------------
// Target + options
// ---------------------------------------------------------------------------

/**
 * How to reach a specific chat-completions endpoint: the fully resolved URL and
 * the request headers (including the vendor-specific auth header). Computed once
 * by the adapter, since neither changes per request.
 */
export interface ChatCompletionsTarget {
  url: string
  headers: Record<string, string>
}

export interface OpenAiJsonWireOptions {
  /** Model identifier sent in the request body. */
  model: string
  /** Non-sensitive log tag, e.g. `[OpenAI]` or `[Azure]`. */
  logTag: string
  /** Resolved URL + headers (carries the auth header — never logged). */
  target: ChatCompletionsTarget
  /** Injected for testability. */
  fetch: typeof globalThis.fetch
  /**
   * Whether to send the `prompt_cache_key` body field. Defaults to true.
   * It is a cloud billing optimisation (OpenAI/Azure) and useless for local
   * runtimes (LM Studio / Ollama / llama.cpp do prefix caching themselves); a
   * strict local server can even 400 on the unknown field. Local factory paths
   * pass false. See ADR 0040.
   */
  sendCacheKey?: boolean
  /**
   * The `response_format.type` to request. Defaults to `'json_object'` (OpenAI /
   * Azure / Mistral). Newer LM Studio dropped `json_object` and 400s on it
   * ("'response_format.type' must be 'json_schema' or 'text'"), so local factory
   * paths pass `'text'` and lean on the tolerant `parseJsonLoose`. `text` is the
   * universal default, accepted by every OpenAI-compatible server. `json_schema`
   * is deliberately not used: with reasoning models LM Studio routes the answer
   * into `reasoning_content` and leaves `content` empty. See ADR 0040.
   */
  responseFormat?: 'json_object' | 'text'
}

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

export class OpenAiJsonWire implements ExtractionWire {
  /**
   * json_object mode has no schema enforcement, so the instruction spells out the
   * exact JSON shape the engine's shared body describes.
   */
  readonly extractInstruction =
    'Stuur je antwoord als JSON-object met de velden "proposedDecisions" (array), "proposedActions" (array) en optioneel "discussionSummaries" (array).'
  readonly inferInstruction =
    'Stuur je antwoord als JSON-object met de velden "agendaItems" (array), "participants" (array) en optioneel "title" (string).'

  private readonly _model: string
  private readonly _logTag: string
  private readonly _target: ChatCompletionsTarget
  private readonly _fetch: typeof globalThis.fetch
  private readonly _sendCacheKey: boolean
  private readonly _responseFormat: 'json_object' | 'text'

  constructor(opts: OpenAiJsonWireOptions) {
    this._model = opts.model
    this._logTag = opts.logTag
    this._target = opts.target
    this._fetch = opts.fetch
    this._sendCacheKey = opts.sendCacheKey ?? true
    this._responseFormat = opts.responseFormat ?? 'json_object'
  }

  /**
   * The OpenAI-compatible wire uses json_object mode and one model regardless of
   * `call` — the extract/infer and rolling/final-pass differences live entirely
   * in the prompt the engine builds. `call` is therefore unused here.
   */
  async callStructured(_call: ExtractionCall, system: string, user: string): Promise<unknown> {
    const content = await this._post(system, user)
    if (content === null) return null
    return parseJsonLoose(content)
  }

  /**
   * POST one chat-completions request and return the message content string, or
   * null on a transport/HTTP/shape failure. Never logs the key, the transcript,
   * or the raw response body (principle #12).
   */
  private async _post(systemPrompt: string, userMessage: string): Promise<string | null> {
    const body = JSON.stringify({
      model: this._model,
      response_format: { type: this._responseFormat },
      // Route identical prefixes to the same cache. The rolling cadence sends a
      // byte-identical system prompt (agenda + participants + instructions) every
      // 15-30s, so a stable key derived from it maximises OpenAI/Azure prompt-cache
      // hits on the dominant rolling cost (Phase 5.4). The key is non-sensitive
      // (a hash of the prompt, never the transcript or the API key). Omitted for
      // local runtimes, where it does nothing and can trip a strict server (ADR 0040).
      ...(this._sendCacheKey
        ? { prompt_cache_key: `${this._model}:${stableHash(systemPrompt)}` }
        : {}),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const response = await this._fetch(this._target.url, {
      method: 'POST',
      headers: this._target.headers,
      body,
    })

    if (!response.ok) {
      console.error(`${this._logTag} HTTP ${String(response.status)}`)
      return null
    }

    const json: unknown = await response.json()

    // Truncated output: the model hit its budget mid-answer. Its result cannot be
    // trusted, and a retry never helps, so throw a distinct error the engine turns
    // into an Extraction Terminal State rather than a retried empty turn (ADR 0042).
    if (extractFinishReason(json) === 'length') {
      console.error(`${this._logTag} Output truncated (finish_reason: length)`)
      throw new ExtractionTruncatedError()
    }

    const content = extractContent(json)
    if (content === null) {
      console.error(`${this._logTag} No content in response`)
      return null
    }
    return content
  }
}

// ---------------------------------------------------------------------------
// Helpers (transport-specific parsing)
// ---------------------------------------------------------------------------

/**
 * Deterministic, non-cryptographic hash (FNV-1a, 32-bit) of a string, as hex.
 * Used only to derive a stable, non-sensitive prompt_cache_key from the system
 * prompt — never for security. Identical prompts hash identically, so rolling
 * ticks within a meeting share a cache route.
 */
function stableHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Parse JSON from a chat-completion message, tolerating endpoints that ignore
 * `response_format: json_object` and wrap the object in a markdown code fence or
 * surrounding prose. Tries, in order: the raw content, the contents of a
 * ```json``` (or bare ```) fence, and the substring from the first `{` to the
 * last `}`. Returns null when none parse. Never logs the content (privacy #12).
 */
function parseJsonLoose(content: string): unknown {
  for (const candidate of jsonCandidates(content)) {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function jsonCandidates(content: string): string[] {
  const trimmed = content.trim()
  const candidates = [trimmed]

  const fence = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(trimmed)
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim())

  // Prose around a JSON object: take the first `{` … last `}`.
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1))

  return candidates
}

function extractContent(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null
  const obj = json as Record<string, unknown>
  const choices = obj.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first: unknown = choices[0]
  if (first === null || typeof first !== 'object') return null
  const message = (first as Record<string, unknown>).message
  if (message === null || typeof message !== 'object') return null
  const content = (message as Record<string, unknown>).content
  return typeof content === 'string' ? content : null
}

/** The first choice's `finish_reason` (e.g. `'stop'` / `'length'`), or null. */
function extractFinishReason(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null
  const choices = (json as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first: unknown = choices[0]
  if (first === null || typeof first !== 'object') return null
  const reason = (first as Record<string, unknown>).finish_reason
  return typeof reason === 'string' ? reason : null
}
