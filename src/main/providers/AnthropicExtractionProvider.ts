/**
 * AnthropicExtractionProvider (item 0010; migrated onto the shared engine in
 * arch review item 3 / ADR 0034).
 *
 * A thin transport adapter for the ExtractionProvider port. `extract` and
 * `inferContext` run through the vendor-neutral ExtractionEngine over an
 * AnthropicToolWire (SDK forced tool use); this adapter only wires them up. The
 * plain-text `summarise` and `query` stay here — they have no structured output
 * and no OpenAI-compatible counterpart, so they are not part of the engine.
 *
 * ## Key design decisions (see ADR 0010, ADR 0034)
 *
 * - Forced tool use (in the wire): `tool_choice: { type: "tool", name }`
 *   guarantees a JSON object via the tool-input mechanism.
 * - Per-item coercion + one-retry-then-empty live in the engine, shared with the
 *   OpenAI-compatible family: a single malformed item is dropped rather than
 *   failing the whole turn (ADR 0034 — a deliberate change from the old strict
 *   all-or-nothing validation).
 * - Privacy principle #12: transcript spans, prompts, API responses, and the API
 *   key are NEVER logged. Only non-sensitive metadata (via devlog / the log tag).
 *
 * ## Constructor params
 *
 * - `apiKey`         — Anthropic API key. Injected; never read from disk here.
 * - `rollingModel`   — Model used for rolling turns. Default: claude-haiku-4-5.
 * - `finalPassModel` — Model used for the final pass + inference. Default: claude-sonnet-4-6.
 */

import Anthropic from '@anthropic-ai/sdk'

import type {
  ExtractionProvider,
  ExtractionRequest,
  ExtractionResponse,
  InferContextInput,
  InferredContext,
} from '@shared/providers'

import { AnthropicToolWire } from './anthropicToolWire'
import { ExtractionEngine } from './extractionEngine'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROLLING_MODEL = 'claude-haiku-4-5'
const DEFAULT_FINAL_PASS_MODEL = 'claude-sonnet-4-6'

const LOG_TAG = '[Anthropic]'

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
  private readonly _engine: ExtractionEngine

  constructor(options: AnthropicExtractionProviderOptions) {
    this._client = new Anthropic({ apiKey: options.apiKey })
    this._rollingModel = options.rollingModel ?? DEFAULT_ROLLING_MODEL
    const finalPassModel = options.finalPassModel ?? DEFAULT_FINAL_PASS_MODEL

    const wire = new AnthropicToolWire({
      client: this._client,
      rollingModel: this._rollingModel,
      finalPassModel,
      logTag: LOG_TAG,
    })
    this._engine = new ExtractionEngine({ wire, logTag: LOG_TAG, model: this._rollingModel })
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    return this._engine.extract(request)
  }

  async inferContext(input: InferContextInput): Promise<InferredContext> {
    return this._engine.inferContext(input)
  }

  // ---------------------------------------------------------------------------
  // Running Summary (item 0020) — vendor-specific, plain text, outside the engine
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
}
