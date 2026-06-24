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

import { isTitleCovered } from '@shared/agenda/agendaTitle'
import {
  ExtractionResponseSchema,
  InferredContextSchema,
  inferSourceToText,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResponse,
  type InferContextInput,
  type InferredContext,
} from '@shared/providers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROLLING_MODEL = 'claude-haiku-4-5'
const DEFAULT_FINAL_PASS_MODEL = 'claude-sonnet-4-6'

const TOOL_NAME = 'extract_meeting_notes'

const INFER_TOOL_NAME = 'infer_meeting_context'

/**
 * JSON schema for the infer_meeting_context tool input. Mirrors
 * InferredContextSchema so the model produces a compatible shape (item 0026).
 */
const INFER_CONTEXT_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' },
    agendaItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          topic: { type: 'string' },
        },
        required: ['title', 'topic'],
      },
    },
    participants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  required: ['agendaItems', 'participants'],
}

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

/**
 * Grounding clause for the infer prompt. When the caller already has agenda
 * items (the live tick), instruct the model to return only NEW topics. Empty
 * when there is no known agenda (paste / final pass over a thin meeting).
 */
function buildGroundingInstruction(
  knownAgendaItems: readonly { title: string; topic: string }[],
): string {
  if (knownAgendaItems.length === 0) return ''
  const lines = knownAgendaItems.map((a) => `- ${a.title}: ${a.topic}`).join('\n')
  return (
    'De agenda bevat al deze punten:\n' +
    `${lines}\n` +
    'Geef alleen NIEUWE agendapunten terug die hier nog niet in staan; herhaal niets. '
  )
}

/**
 * Enforce append-only grounding regardless of what the model returned: drop any
 * inferred agenda item whose title already matches a known one (ADR 0029).
 */
function groundInferred(
  ctx: InferredContext,
  knownAgendaItems: readonly { title: string }[],
): InferredContext {
  if (knownAgendaItems.length === 0) return ctx
  return {
    ...ctx,
    agendaItems: ctx.agendaItems.filter((a) => !isTitleCovered(a.title, knownAgendaItems)),
  }
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
  // Running Summary (item 0020)
  // ---------------------------------------------------------------------------

  /**
   * Produce a plain-text paragraph summarising the meeting so far.
   * Uses the rolling model (Haiku) — latency matters here too.
   * No structured output; plain text response.
   *
   * Never logs transcript content (principle #12).
   */
  async summarise(spans: import('@shared/domain/types').TranscriptSpan[]): Promise<string> {
    if (spans.length === 0) return ''

    const spanLines = spans
      .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
      .join('\n')

    const response = await this._client.messages.create({
      model: this._rollingModel,
      max_tokens: 512,
      system:
        'Je bent een assistent die een beknopte samenvatting geeft van een vergadering tot nu toe. ' +
        'Geef één alinea in gewone taal. Geen opsommingen, geen koppen.',
      messages: [
        {
          role: 'user',
          content: `Geef een korte samenvatting van de vergadering op basis van dit transcript:\n${spanLines}`,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (textBlock?.type !== 'text') return ''
    return textBlock.text
  }

  /**
   * Answer a free-form question grounded in the current transcript.
   * Uses the rolling model (Haiku).
   * No structured output; plain text response.
   *
   * Never logs transcript content or the question (principle #12).
   */
  async query(
    spans: import('@shared/domain/types').TranscriptSpan[],
    question: string,
  ): Promise<string> {
    if (spans.length === 0) return ''

    const spanLines = spans
      .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
      .join('\n')

    const response = await this._client.messages.create({
      model: this._rollingModel,
      max_tokens: 512,
      system:
        'Je bent een assistent die vragen beantwoordt op basis van een vergadertranscript. ' +
        'Wees bondig en feitelijk. Geef alleen antwoord op basis van het transcript.',
      messages: [
        {
          role: 'user',
          content: `Transcript:\n${spanLines}\n\nVraag: ${question}`,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (textBlock?.type !== 'text') return ''
    return textBlock.text
  }

  // ---------------------------------------------------------------------------
  // Infer context (item 0026)
  // ---------------------------------------------------------------------------

  /**
   * Infer Agenda Items and Participants from a whole transcript, for an
   * Imported Meeting where the user did not supply them. Uses the final-pass
   * model (sonnet) — this is a holistic whole-transcript task, not latency
   * sensitive. Forced tool use + Zod validation, one-retry-then-empty so a bad
   * response degrades to an empty context rather than throwing into the import.
   *
   * Never logs transcript content or the API key (principle #12).
   */
  async inferContext(input: InferContextInput): Promise<InferredContext> {
    const content = inferSourceToText(input.source)
    if (content.trim() === '') return { agendaItems: [], participants: [] }

    const known = input.knownAgendaItems ?? []

    const first = await this._callAndValidateInfer(content, known)
    if (first !== null) return groundInferred(first, known)

    console.error('[AnthropicExtractionProvider] Context inference validation failed, retrying')
    const retry = await this._callAndValidateInfer(content, known)
    if (retry !== null) return groundInferred(retry, known)

    console.error('[AnthropicExtractionProvider] Context inference retry failed, returning empty')
    return { agendaItems: [], participants: [] }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Call the API for context inference and validate with Zod. Returns a valid
   * InferredContext or null on validation failure. Never logs content.
   */
  private async _callAndValidateInfer(
    content: string,
    knownAgendaItems: readonly { title: string; topic: string }[],
  ): Promise<InferredContext | null> {
    const response = await this._client.messages.create({
      model: this._finalPassModel,
      max_tokens: 2048,
      system:
        'Je leidt de agenda, de deelnemers en een korte vergadertitel af uit de bron. ' +
        'Geef per agendapunt een korte title en topic. Geef alleen namen van deelnemers ' +
        'die echt in de bron voorkomen; verzin niemand. Bij twijfel laat je de lijst leeg. ' +
        buildGroundingInstruction(knownAgendaItems) +
        'Gebruik de infer_meeting_context tool om het resultaat terug te geven.',
      messages: [{ role: 'user', content: `Transcript:\n${content}` }],
      tools: [
        {
          name: INFER_TOOL_NAME,
          description: 'Infer the agenda items and participants from the meeting transcript.',
          input_schema: INFER_CONTEXT_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: INFER_TOOL_NAME },
    })

    const toolBlock = response.content.find((block) => block.type === 'tool_use')
    if (toolBlock?.type !== 'tool_use') {
      console.error('[AnthropicExtractionProvider] No tool_use block in inference response')
      return null
    }

    const parsed = InferredContextSchema.safeParse(toolBlock.input)
    if (!parsed.success) return null
    return parsed.data
  }

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
      // Cache the stable prefix (tools + agenda + participants + instructions).
      // The rolling cadence fires this same prefix every 15-30s with only the
      // transcript (the user message) growing, so an ephemeral cache breakpoint
      // on the system block cuts the dominant rolling cost (ADR 0010, Phase 5.4).
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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
