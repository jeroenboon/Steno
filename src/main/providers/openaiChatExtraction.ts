/**
 * Shared extraction engine for OpenAI-compatible chat-completions endpoints.
 *
 * OpenAI, Mistral and Azure OpenAI all speak the same `chat/completions` wire
 * with JSON mode (`response_format: { type: "json_object" }`). They differ only
 * in the request URL and the auth header (OpenAI/Mistral use
 * `Authorization: Bearer`, Azure uses `api-key`). That difference is captured by
 * the injected `ChatCompletionsTarget`; everything else — prompt building,
 * response parsing, Zod validation, and the one-retry-then-degrade strategy
 * (mirroring AnthropicExtractionProvider) — lives here, so the per-vendor
 * adapters stay thin.
 *
 * ## Privacy (principle #12)
 * The API key only ever appears inside the injected `target.headers`; it is
 * never logged. Logs carry the non-sensitive `logTag` (e.g. `[OpenAI]`,
 * `[Azure]`) so vendors are distinguishable without exposing content or keys.
 */

import {
  ExtractionResponseSchema,
  InferredContextSchema,
  inferSourceToText,
  type ExtractionRequest,
  type ExtractionResponse,
  type InferContextInput,
  type InferredContext,
} from '@shared/providers'

// ---------------------------------------------------------------------------
// Target + engine options
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

export interface ChatExtractionEngineOptions {
  /** Model identifier sent in the request body. */
  model: string
  /** Non-sensitive log tag, e.g. `[OpenAI]` or `[Azure]`. */
  logTag: string
  /** Resolved URL + headers (carries the auth header — never logged). */
  target: ChatCompletionsTarget
  /** Injected for testability. */
  fetch: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ChatExtractionEngine {
  private readonly _model: string
  private readonly _logTag: string
  private readonly _target: ChatCompletionsTarget
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: ChatExtractionEngineOptions) {
    this._model = opts.model
    this._logTag = opts.logTag
    this._target = opts.target
    this._fetch = opts.fetch
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    const first = await this._callAndValidate(request)
    if (first !== null) return first

    console.error(`${this._logTag} Validation failed, retrying`)
    const retry = await this._callAndValidate(request)
    if (retry !== null) return retry

    console.error(`${this._logTag} Retry failed, skipping turn`)
    return { proposedDecisions: [], proposedActions: [] }
  }

  async inferContext(input: InferContextInput): Promise<InferredContext> {
    const content = inferSourceToText(input.source)
    if (content.trim() === '') return { agendaItems: [], participants: [] }

    const first = await this._callAndValidateInfer(content)
    if (first !== null) return first

    console.error(`${this._logTag} Context inference failed, retrying`)
    const retry = await this._callAndValidateInfer(content)
    if (retry !== null) return retry

    console.error(`${this._logTag} Context inference retry failed, returning empty`)
    return { agendaItems: [], participants: [] }
  }

  private async _callAndValidate(request: ExtractionRequest): Promise<ExtractionResponse | null> {
    const content = await this._post(buildSystemPrompt(request), buildUserMessage(request))
    if (content === null) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(content) as unknown
    } catch {
      return null
    }

    const validated = ExtractionResponseSchema.safeParse(parsed)
    if (!validated.success) return null
    return validated.data
  }

  private async _callAndValidateInfer(sourceText: string): Promise<InferredContext | null> {
    const content = await this._post(buildInferSystemPrompt(), `Transcript:\n${sourceText}`)
    if (content === null) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(content) as unknown
    } catch {
      return null
    }

    const validated = InferredContextSchema.safeParse(parsed)
    if (!validated.success) return null
    return validated.data
  }

  /**
   * POST one chat-completions request and return the message content string, or
   * null on a transport/HTTP/shape failure. Never logs the key, the transcript,
   * or the raw response body (principle #12).
   */
  private async _post(systemPrompt: string, userMessage: string): Promise<string | null> {
    const body = JSON.stringify({
      model: this._model,
      response_format: { type: 'json_object' },
      // Route identical prefixes to the same cache. The rolling cadence sends a
      // byte-identical system prompt (agenda + participants + instructions) every
      // 15-30s, so a stable key derived from it maximises OpenAI/Azure prompt-cache
      // hits on the dominant rolling cost (Phase 5.4). The key is non-sensitive
      // (a hash of the prompt, never the transcript or the API key).
      prompt_cache_key: `${this._model}:${stableHash(systemPrompt)}`,
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
    const content = extractContent(json)
    if (content === null) {
      console.error(`${this._logTag} No content in response`)
      return null
    }
    return content
  }
}

// ---------------------------------------------------------------------------
// Helpers (shared prompt building + response parsing)
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

function buildSystemPrompt(request: ExtractionRequest): string {
  const agendaLines =
    request.agendaItems.length > 0
      ? request.agendaItems.map((a, i) => `${String(i + 1)}. ${a.title}`).join('\n')
      : '(geen agenda)'

  const participantNames =
    request.participants.length > 0
      ? request.participants.map((p) => p.name).join(', ')
      : '(geen deelnemers)'

  const summariesInstruction = request.isFinalPass
    ? `\n\nDit is de EINDEXTRACTIE. Voeg ook een "discussionSummaries" array toe met een object per agendapunt: { "agendaItemId": "...", "text": "..." }.`
    : ''

  return `Je bent een assistent die vergadernotities analyseert. Stuur je antwoord als JSON-object met de velden "proposedDecisions" (array), "proposedActions" (array) en optioneel "discussionSummaries" (array).

Primaire taal: ${request.primaryLanguage}
Agenda:\n${agendaLines}
Deelnemers: ${participantNames}${summariesInstruction}

Schema voor proposedDecisions items: { "rationale": string, "sourceSpanId": string, "agendaItemHint"?: string }
Schema voor proposedActions items: { "description": string, "sourceSpanId": string, "ownerHint"?: string, "agendaItemHint"?: string }`
}

function buildInferSystemPrompt(): string {
  return `Je leidt de agenda en de deelnemers af uit een vergadertranscript. Stuur je antwoord als JSON-object met de velden "agendaItems" (array) en "participants" (array).

Schema voor agendaItems items: { "title": string, "topic": string }
Schema voor participants items: { "name": string }

Geef alleen namen van deelnemers die echt in het transcript voorkomen; verzin niemand. Bij twijfel laat je de lijst leeg.`
}

function buildUserMessage(request: ExtractionRequest): string {
  const spanLines = request.spans
    .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
    .join('\n')
  return `Transcript:\n${spanLines}`
}
