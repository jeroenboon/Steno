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

import type { z } from 'zod'

import { excludeCoveredAgendaItems } from '@shared/agenda/agendaTitle'
import {
  InferredContextSchema,
  ProposedActionSchema,
  ProposedDecisionSchema,
  ProposedDiscussionSummarySchema,
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

    const known = input.knownAgendaItems ?? []

    const first = await this._callAndValidateInfer(content, known)
    if (first !== null) return excludeCoveredAgendaItems(first, known)

    console.error(`${this._logTag} Context inference failed, retrying`)
    const retry = await this._callAndValidateInfer(content, known)
    if (retry !== null) return excludeCoveredAgendaItems(retry, known)

    console.error(`${this._logTag} Context inference retry failed, returning empty`)
    return { agendaItems: [], participants: [] }
  }

  private async _callAndValidate(request: ExtractionRequest): Promise<ExtractionResponse | null> {
    const content = await this._post(buildSystemPrompt(request), buildUserMessage(request))
    if (content === null) return null

    const parsed = parseJsonLoose(content)
    if (parsed === null) return null

    return coerceExtractionResponse(parsed)
  }

  private async _callAndValidateInfer(
    sourceText: string,
    knownAgendaItems: readonly { title: string; topic: string }[],
  ): Promise<InferredContext | null> {
    const content = await this._post(
      buildInferSystemPrompt(knownAgendaItems),
      `Transcript:\n${sourceText}`,
    )
    if (content === null) return null

    const parsed = parseJsonLoose(content)
    if (parsed === null) return null

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

/**
 * Build an ExtractionResponse from an already-parsed object, leniently: a
 * missing `proposedDecisions` / `proposedActions` becomes an empty array, and a
 * single malformed item is dropped rather than failing the whole turn. Returns
 * null only when the value is not a JSON object at all (→ retry). This is a
 * deliberate softening of the strict all-or-nothing schema for LLM output: the
 * items are Proposed and reviewed by the note-taker, so keeping the valid ones
 * beats discarding a whole turn over one bad field.
 */
function coerceExtractionResponse(parsed: unknown): ExtractionResponse | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  const response: ExtractionResponse = {
    proposedDecisions: keepValid(obj.proposedDecisions, ProposedDecisionSchema),
    proposedActions: keepValid(obj.proposedActions, ProposedActionSchema),
  }

  // discussionSummaries is present only on the final pass; keep it out of the
  // object entirely when absent (exactOptionalPropertyTypes).
  if (obj.discussionSummaries !== undefined) {
    response.discussionSummaries = keepValid(
      obj.discussionSummaries,
      ProposedDiscussionSummarySchema,
    )
  }

  return response
}

/** Validate each element against `schema`, keeping only the ones that pass. */
function keepValid<S extends z.ZodTypeAny>(value: unknown, schema: S): z.infer<S>[] {
  if (!Array.isArray(value)) return []
  const out: z.infer<S>[] = []
  for (const item of value) {
    const result = schema.safeParse(item)
    if (result.success) out.push(result.data as z.infer<S>)
  }
  return out
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

function buildInferSystemPrompt(
  knownAgendaItems: readonly { title: string; topic: string }[],
): string {
  const grounding =
    knownAgendaItems.length === 0
      ? ''
      : `\n\nDe agenda bevat al deze punten:\n${knownAgendaItems
          .map((a) => `- ${a.title}: ${a.topic}`)
          .join(
            '\n',
          )}\nGeef alleen NIEUWE agendapunten terug die hier nog niet in staan; herhaal niets.`

  return `Je leidt de agenda, de deelnemers en een korte vergadertitel af uit de bron. Stuur je antwoord als JSON-object met de velden "agendaItems" (array), "participants" (array) en optioneel "title" (string).

Schema voor agendaItems items: { "title": string, "topic": string }
Schema voor participants items: { "name": string }

Geef alleen namen van deelnemers die echt in de bron voorkomen; verzin niemand. Bij twijfel laat je de lijst leeg.${grounding}`
}

function buildUserMessage(request: ExtractionRequest): string {
  const spanLines = request.spans
    .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
    .join('\n')
  return `Transcript:\n${spanLines}`
}
