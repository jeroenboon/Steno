/**
 * CustomOpenAIExtractionProvider (item 0012).
 *
 * An ExtractionProvider adapter for OpenAI-compatible endpoints (OpenAI,
 * Azure OpenAI, local proxies, etc.). Uses the OpenAI chat completions API
 * with JSON mode / structured output via `response_format: { type: "json_object" }`.
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
 * Authorization header and is never logged.
 *
 * ## Constructor params
 * - `apiKey`     — Raw API key for the endpoint. Injected by the factory.
 * - `baseUrl`    — Base URL, e.g. https://api.openai.com/v1
 * - `model`      — Model identifier, e.g. gpt-4o
 * - `displayName` — Shown in logs (non-sensitive) and egress disclosure.
 * - `fetch`       — Injected for testability. Defaults to global fetch.
 */

import {
  ExtractionResponseSchema,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResponse,
} from '@shared/providers'

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface CustomOpenAIExtractionProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  displayName: string
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CustomOpenAIExtractionProvider implements ExtractionProvider {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _model: string
  private readonly _displayName: string
  private readonly _fetch: typeof globalThis.fetch

  constructor(opts: CustomOpenAIExtractionProviderOptions) {
    this._apiKey = opts.apiKey
    this._baseUrl = opts.baseUrl.replace(/\/$/, '') // strip trailing slash
    this._model = opts.model
    this._displayName = opts.displayName
    this._fetch = opts.fetch ?? globalThis.fetch
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    const first = await this._callAndValidate(request)
    if (first !== null) return first

    console.error(
      `[CustomOpenAIExtractionProvider:${this._displayName}] Validation failed, retrying`,
    )
    const retry = await this._callAndValidate(request)
    if (retry !== null) return retry

    console.error(
      `[CustomOpenAIExtractionProvider:${this._displayName}] Retry failed, skipping turn`,
    )
    return { proposedDecisions: [], proposedActions: [] }
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
      console.error(
        `[CustomOpenAIExtractionProvider:${this._displayName}] HTTP ${String(response.status)}`,
      )
      return null
    }

    const json: unknown = await response.json()
    const content = extractContent(json)
    if (content === null) {
      console.error(`[CustomOpenAIExtractionProvider:${this._displayName}] No content in response`)
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

function buildUserMessage(request: ExtractionRequest): string {
  const spanLines = request.spans
    .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
    .join('\n')
  return `Transcript:\n${spanLines}`
}
