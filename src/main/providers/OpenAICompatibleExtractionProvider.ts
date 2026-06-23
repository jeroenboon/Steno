/**
 * OpenAICompatibleExtractionProvider (items 0012, 0026; generalised in Phase 1.3).
 *
 * An ExtractionProvider adapter for OpenAI-compatible chat-completions endpoints.
 * One wire serves the whole family — OpenAI, Mistral, local proxies, and any
 * generic custom endpoint — because they share the chat-completions request and
 * response shapes. The vendor is just a prefilled base URL + model + displayName
 * (see the preset catalog, extractionPresets.ts); it changes no parsing here.
 * Uses JSON mode via `response_format: { type: "json_object" }`.
 *
 * ## Design
 *
 * This adapter uses the Fetch API directly (no OpenAI SDK dependency) to keep
 * the dependency surface minimal and to avoid pulling in the full SDK for
 * what is a simple chat completion call.
 *
 * The structured-output strategy mirrors AnthropicExtractionProvider:
 *   - We ask the model to respond with JSON matching the ExtractionResponse schema.
 *   - One retry on validation failure; skip the turn if the retry also fails.
 *
 * ## Privacy (principle #12)
 * The API key is injected (never read from disk here). It is passed in the
 * Authorization header and is never logged. Logs are tagged with the
 * (non-sensitive) `displayName` only, so `[OpenAI]` / `[Mistral]` / `[Custom]`
 * are distinguishable without exposing transcript content or the key.
 *
 * ## Constructor params
 * - `apiKey`     — Raw API key for the endpoint. Injected by the factory.
 * - `baseUrl`    — Base URL, e.g. https://api.openai.com/v1
 * - `model`      — Model identifier, e.g. gpt-4o-mini
 * - `displayName` — Shown in logs (non-sensitive) and egress disclosure.
 * - `fetch`       — Injected for testability. Defaults to global fetch.
 */

import type { TranscriptSpan } from '@shared/domain/types'
import {
  ExtractionResponseSchema,
  InferredContextSchema,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResponse,
  type InferredContext,
} from '@shared/providers'

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface OpenAICompatibleExtractionProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  displayName: string
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAICompatibleExtractionProvider implements ExtractionProvider {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _model: string
  /** Non-sensitive log tag, e.g. `[OpenAI]`, so logs distinguish the vendor. */
  private readonly _logTag: string
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: OpenAICompatibleExtractionProviderOptions) {
    this._apiKey = opts.apiKey
    this._baseUrl = opts.baseUrl.replace(/\/$/, '') // strip trailing slash
    this._model = opts.model
    this._logTag = `[${opts.displayName}]`
    this._fetch = opts.fetch ?? globalThis.fetch
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

  /**
   * Infer Agenda Items and Participants from a whole transcript, for an
   * Imported Meeting where the user did not supply them (item 0026). Mirrors
   * extract()'s one-retry-then-empty strategy so a bad response degrades to an
   * empty context rather than throwing into the import.
   *
   * Never logs transcript content or the API key (principle #12).
   */
  async inferContext(spans: TranscriptSpan[]): Promise<InferredContext> {
    if (spans.length === 0) return { agendaItems: [], participants: [] }

    const first = await this._callAndValidateInfer(spans)
    if (first !== null) return first

    console.error(`${this._logTag} Context inference failed, retrying`)
    const retry = await this._callAndValidateInfer(spans)
    if (retry !== null) return retry

    console.error(`${this._logTag} Context inference retry failed, returning empty`)
    return { agendaItems: [], participants: [] }
  }

  private async _callAndValidateInfer(spans: TranscriptSpan[]): Promise<InferredContext | null> {
    const spanLines = spans
      .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
      .join('\n')

    const url = `${this._baseUrl}/chat/completions`
    const body = JSON.stringify({
      model: this._model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildInferSystemPrompt() },
        { role: 'user', content: `Transcript:\n${spanLines}` },
      ],
    })

    const response = await this._fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      },
      body,
    })

    if (!response.ok) {
      console.error(`${this._logTag} HTTP ${String(response.status)} on inference`)
      return null
    }

    const json: unknown = await response.json()
    const content = extractContent(json)
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

  private async _callAndValidate(request: ExtractionRequest): Promise<ExtractionResponse | null> {
    const systemPrompt = buildSystemPrompt(request)
    const userMessage = buildUserMessage(request)

    // Privacy: never log apiKey, transcript content, or raw response body
    const url = `${this._baseUrl}/chat/completions`

    const body = JSON.stringify({
      model: this._model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const response = await this._fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      },
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
