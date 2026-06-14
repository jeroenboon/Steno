/**
 * AnthropicExtractionProvider (item 0010).
 *
 * Real cloud adapter for the ExtractionProvider port. Uses the Anthropic SDK
 * with forced tool use to get structured JSON output, validated by the Zod
 * DTOs from item 0005.
 *
 * ## Key design decisions (see ADR 0010)
 *
 * - Forced tool use: `tool_choice: { type: "tool", name: "extract_meeting_notes" }`
 *   guarantees the model returns a JSON object via the tool-input mechanism,
 *   eliminating free-text parsing.
 * - One-retry-then-skip: if Zod validation fails, we retry the exact same
 *   call once. A second failure returns an empty response rather than
 *   throwing, so the scheduler's cadence continues uninterrupted.
 * - Privacy principle #12: transcript spans, prompts, API responses, and the
 *   API key are NEVER logged. Only non-sensitive metadata is written to logs.
 *
 * ## Constructor params
 *
 * - `apiKey`         — Anthropic API key. Injected; never read from disk here
 *                      (secrets management is item 0012).
 * - `rollingModel`   — Model used for rolling turns. Default: claude-haiku-4-5.
 * - `finalPassModel` — Model used for the final pass. Default: claude-sonnet-4-6.
 */

import Anthropic from '@anthropic-ai/sdk'

import {
  ExtractionResponseSchema,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResponse,
} from '@shared/providers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROLLING_MODEL = 'claude-haiku-4-5'
const DEFAULT_FINAL_PASS_MODEL = 'claude-sonnet-4-6'

const TOOL_NAME = 'extract_meeting_notes'

/**
 * The JSON schema for the extract_meeting_notes tool input.
 * Mirrors ExtractionResponseSchema so the model produces a compatible shape.
 */
const EXTRACTION_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    proposedDecisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rationale: { type: 'string' },
          sourceSpanId: { type: 'string' },
          agendaItemHint: { type: 'string' },
        },
        required: ['rationale', 'sourceSpanId'],
      },
    },
    proposedActions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          sourceSpanId: { type: 'string' },
          ownerHint: { type: 'string' },
          agendaItemHint: { type: 'string' },
        },
        required: ['description', 'sourceSpanId'],
      },
    },
    discussionSummaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agendaItemId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['agendaItemId', 'text'],
      },
    },
  },
  required: ['proposedDecisions', 'proposedActions'],
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface AnthropicExtractionProviderOptions {
  apiKey: string
  rollingModel?: string
  finalPassModel?: string
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicExtractionProvider implements ExtractionProvider {
  private readonly _client: Anthropic
  private readonly _rollingModel: string
  private readonly _finalPassModel: string

  constructor(options: AnthropicExtractionProviderOptions) {
    this._client = new Anthropic({ apiKey: options.apiKey })
    this._rollingModel = options.rollingModel ?? DEFAULT_ROLLING_MODEL
    this._finalPassModel = options.finalPassModel ?? DEFAULT_FINAL_PASS_MODEL
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    const model = request.isFinalPass ? this._finalPassModel : this._rollingModel

    // First attempt
    const firstResult = await this._callAndValidate(request, model)
    if (firstResult !== null) return firstResult

    // One retry (principle: one-retry-then-skip)
    console.error('[AnthropicExtractionProvider] Validation failed, retrying turn')
    const retryResult = await this._callAndValidate(request, model)
    if (retryResult !== null) return retryResult

    // Skip this turn — return empty response so scheduler continues
    console.error('[AnthropicExtractionProvider] Retry failed, skipping turn')
    return { proposedDecisions: [], proposedActions: [] }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Call the Anthropic API and validate the tool-use response with Zod.
   * Returns a valid ExtractionResponse or null on validation failure.
   * Throws on network/auth errors (scheduler catches those).
   *
   * Never logs request content or the raw response body (principle #12).
   */
  private async _callAndValidate(
    request: ExtractionRequest,
    model: string,
  ): Promise<ExtractionResponse | null> {
    const systemPrompt = buildSystemPrompt(request)
    const userMessage = buildUserMessage(request)

    const response = await this._client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      tools: [
        {
          name: TOOL_NAME,
          description:
            'Extract decisions, actions, and (on the final pass) discussion summaries from the meeting transcript.',
          input_schema: EXTRACTION_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    })

    // Extract the tool_use block from the response
    const toolBlock = response.content.find((block) => block.type === 'tool_use')
    if (toolBlock?.type !== 'tool_use') {
      console.error('[AnthropicExtractionProvider] No tool_use block in response')
      return null
    }

    // Validate with Zod — never log toolBlock.input (may contain content)
    const parsed = ExtractionResponseSchema.safeParse(toolBlock.input)
    if (!parsed.success) {
      return null
    }

    return parsed.data
  }
}

// ---------------------------------------------------------------------------
// Prompt builders — never logged (principle #12)
// ---------------------------------------------------------------------------

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
    ? `\n\nDit is de EINDEXTRACTIE. Genereer ook een discussionSummaries array met een korte samenvatting per agendapunt (agendaItemId + text).`
    : ''

  return `Je bent een assistent die vergadernotities analyseert en beslissingen en actiepunten extraheert.

Primaire taal van de vergadering: ${request.primaryLanguage}
Geef alle tekst (rationale, description, text) terug in de primaire taal van de vergadering.

Agenda:
${agendaLines}

Deelnemers: ${participantNames}
${summariesInstruction}
Gebruik de extract_meeting_notes tool om de resultaten terug te geven.`
}

function buildUserMessage(request: ExtractionRequest): string {
  const spanLines = request.spans
    .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
    .join('\n')

  return `Transcript:\n${spanLines}`
}
