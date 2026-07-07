/**
 * Anthropic tool-use transport wire for the ExtractionEngine (ADR 0034).
 *
 * Anthropic gets structured output through forced tool use
 * (`tool_choice: { type: "tool", name }`): the model returns the result in a
 * `tool_use` block whose `input` is an already-parsed object. That object is the
 * candidate the engine coerces — there is no JSON string to parse, so this wire
 * has no `parseJsonLoose` equivalent (contrast OpenAiJsonWire).
 *
 * This wire owns everything transport-specific: the SDK call, the tool
 * definitions + `input_schema`s, model selection per pass (haiku rolling, sonnet
 * final + inference), and the `cache_control: ephemeral` prefix cache. It returns
 * the tool input, or null when the response carries no tool_use block.
 *
 * ## Privacy (principle #12)
 * The API key lives inside the injected SDK client and is never logged. Logs
 * carry the non-sensitive `logTag` only.
 */

import type Anthropic from '@anthropic-ai/sdk'

import {
  ExtractionTruncatedError,
  type ExtractionCall,
  type ExtractionWire,
} from './extractionEngine'

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_NAME = 'extract_meeting_notes'
const INFER_TOOL_NAME = 'infer_meeting_context'

/**
 * JSON schema for the extract_meeting_notes tool input. Mirrors
 * ExtractionResponseSchema so the model produces a compatible shape; the engine
 * coerces the returned object per-item (ADR 0034).
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
          agendaItemHint: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['text'],
      },
    },
  },
  required: ['proposedDecisions', 'proposedActions'],
}

/**
 * JSON schema for the infer_meeting_context tool input. Mirrors
 * InferredContextSchema so the model produces a compatible shape.
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AnthropicToolWireOptions {
  /** Injected SDK client (carries the API key — never logged). */
  client: Anthropic
  /** Model for rolling extraction turns (latency-sensitive). */
  rollingModel: string
  /** Model for the final pass and context inference (holistic, not latency-sensitive). */
  finalPassModel: string
  /** Non-sensitive log tag, e.g. `[Anthropic]`. */
  logTag: string
}

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

export class AnthropicToolWire implements ExtractionWire {
  readonly extractInstruction =
    'Gebruik de extract_meeting_notes tool om de resultaten terug te geven.'
  readonly inferInstruction =
    'Gebruik de infer_meeting_context tool om het resultaat terug te geven.'

  private readonly _client: Anthropic
  private readonly _rollingModel: string
  private readonly _finalPassModel: string
  private readonly _logTag: string

  constructor(opts: AnthropicToolWireOptions) {
    this._client = opts.client
    this._rollingModel = opts.rollingModel
    this._finalPassModel = opts.finalPassModel
    this._logTag = opts.logTag
  }

  async callStructured(call: ExtractionCall, system: string, user: string): Promise<unknown> {
    if (call.kind === 'extract') {
      const response = await this._client.messages.create({
        model: call.isFinalPass ? this._finalPassModel : this._rollingModel,
        max_tokens: 4096,
        // Cache the stable prefix (tools + agenda + participants + instructions).
        // The rolling cadence fires this same prefix every 15-30s with only the
        // transcript (the user message) growing, so an ephemeral cache breakpoint
        // on the system block cuts the dominant rolling cost (ADR 0010, Phase 5.4).
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
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
      return this._toolInput(response, TOOL_NAME)
    }

    const response = await this._client.messages.create({
      model: this._finalPassModel,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [
        {
          name: INFER_TOOL_NAME,
          description: 'Infer the agenda items and participants from the meeting transcript.',
          input_schema: INFER_CONTEXT_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: INFER_TOOL_NAME },
    })
    return this._toolInput(response, INFER_TOOL_NAME)
  }

  /**
   * Pull the tool input object out of a messages response, or null when the model
   * returned no tool_use block. Never logs the input (may contain content).
   */
  private _toolInput(
    response: Awaited<ReturnType<Anthropic['messages']['create']>>,
    toolName: string,
  ): unknown {
    // Truncated output: the model hit max_tokens mid-answer, so its result cannot
    // be trusted and a retry never helps. Throw a distinct error the engine turns
    // into an Extraction Terminal State rather than a retried empty turn (ADR 0042).
    if ('stop_reason' in response && response.stop_reason === 'max_tokens') {
      console.error(`${this._logTag} Output truncated (stop_reason: max_tokens)`)
      throw new ExtractionTruncatedError()
    }
    if (!('content' in response) || !Array.isArray(response.content)) return null
    const block = response.content.find((b) => b.type === 'tool_use')
    if (block?.type !== 'tool_use') {
      console.error(`${this._logTag} No tool_use block in response (${toolName})`)
      return null
    }
    return block.input
  }
}
