/**
 * Vendor-neutral extraction engine (arch review item 3, ADR 0034).
 *
 * The engine owns the whole extraction contract — prompt building, per-item Zod
 * coercion, the one-retry-then-degrade strategy, devlog, and the inferContext
 * flow — independent of transport. It talks to an `ExtractionWire` seam that,
 * given the prompts, returns a parsed candidate object (or null on a
 * transport/HTTP/shape failure). Each vendor supplies only that wire:
 *
 *  - the OpenAI-compatible family via `openAiJsonWire.ts` (fetch + json_object,
 *    then `parseJsonLoose` to a candidate object);
 *  - Anthropic via `anthropicToolWire.ts` (SDK forced tool use; the tool input
 *    is already an object). [commit 2]
 *
 * The seam sits at the one point where both families become identical: a parsed
 * candidate object. `parseJsonLoose` stays in the OpenAI wire; the SDK tool-use
 * decode stays in the Anthropic wire.
 *
 * ## Privacy (principle #12)
 * The engine never sees the API key (it lives inside the wire). Logs carry the
 * non-sensitive `logTag`; transcript content is written only under the devlog
 * content opt-in.
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

import { devlog } from '../devlog'

// ---------------------------------------------------------------------------
// Wire seam
// ---------------------------------------------------------------------------

/**
 * What the engine is asking the wire to do. `kind` selects the structured-output
 * mechanism (extract vs infer); `isFinalPass` lets a wire pick a different model
 * for the final pass (Anthropic uses sonnet there). OpenAI-compatible wires
 * ignore `isFinalPass` — one model, and the final-pass difference is entirely in
 * the prompt the engine builds.
 */
export type ExtractionCall =
  | { readonly kind: 'extract'; readonly isFinalPass: boolean }
  | { readonly kind: 'infer' }

/**
 * The per-vendor transport seam. Given the fully built system + user prompts,
 * return a parsed candidate object, or null on a transport/HTTP/shape failure.
 * The wire owns everything vendor-specific: the connection, auth, the
 * structured-output mechanism, and getting from the raw response to a parsed
 * object. It never validates the domain shape — the engine coerces.
 *
 * Returns `null` on failure. (`unknown` already includes `null`, so the type is
 * just `Promise<unknown>`; the convention is that `null` means "no candidate".)
 */
export interface ExtractionWire {
  callStructured(call: ExtractionCall, system: string, user: string): Promise<unknown>

  /**
   * The per-vendor "how to hand the result back" sentence the engine appends to
   * the shared prompt body. This is the one part of the prompt that is genuinely
   * mechanism-specific: "Gebruik de extract_meeting_notes tool" (tool use) vs
   * "Stuur je antwoord als JSON-object" (json_object mode). Everything else in
   * the prompt — agenda, participants, language, schema — is shared (ADR 0034).
   */
  readonly extractInstruction: string
  /** As {@link extractInstruction}, for the context-inference call. */
  readonly inferInstruction: string
}

export interface ExtractionEngineOptions {
  /** The per-vendor transport. */
  wire: ExtractionWire
  /** Non-sensitive log tag, e.g. `[OpenAI]` or `[Azure]`. */
  logTag: string
  /** Model identifier, for non-sensitive devlog metadata. */
  model: string
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ExtractionEngine {
  private readonly _wire: ExtractionWire
  private readonly _logTag: string
  private readonly _model: string

  constructor(opts: ExtractionEngineOptions) {
    this._wire = opts.wire
    this._logTag = opts.logTag
    this._model = opts.model
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    const first = await this._callAndCoerce(request)
    if (first !== null) return first

    console.error(`${this._logTag} Validation failed, retrying`)
    const retry = await this._callAndCoerce(request)
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

  private async _callAndCoerce(request: ExtractionRequest): Promise<ExtractionResponse | null> {
    const systemPrompt = `${buildExtractBody(request)}\n\n${this._wire.extractInstruction}`
    const userMessage = buildUserMessage(request)
    const candidate = await this._wire.callStructured(
      { kind: 'extract', isFinalPass: request.isFinalPass },
      systemPrompt,
      userMessage,
    )

    // The request (agenda + participants + transcript) is content; it is only
    // written when the --debug opt-in is on. meta stays non-sensitive.
    const meta = { tag: this._logTag, model: this._model, isFinalPass: request.isFinalPass }
    const reqContent = { request: JSON.stringify({ system: systemPrompt, user: userMessage }) }

    if (candidate === null) {
      devlog('extraction', 'call-failed', meta, reqContent)
      return null
    }

    const coerced = coerceExtractionResponse(candidate)
    if (coerced === null) {
      devlog('extraction', 'not-an-object', meta, {
        ...reqContent,
        response: JSON.stringify(candidate),
      })
      return null
    }

    const { decisionsKept, decisionsRaw, actionsKept, actionsRaw, droppedPaths } =
      coerced.diagnostics
    devlog(
      'extraction',
      'turn',
      {
        ...meta,
        decisions: `${String(decisionsKept)}/${String(decisionsRaw)}`,
        actions: `${String(actionsKept)}/${String(actionsRaw)}`,
        ...(droppedPaths.length > 0 ? { dropped: droppedPaths } : {}),
      },
      { ...reqContent, response: JSON.stringify(candidate) },
    )

    return coerced.response
  }

  private async _callAndValidateInfer(
    sourceText: string,
    knownAgendaItems: readonly { title: string; topic: string }[],
  ): Promise<InferredContext | null> {
    const candidate = await this._wire.callStructured(
      { kind: 'infer' },
      `${buildInferBody(knownAgendaItems)}\n\n${this._wire.inferInstruction}`,
      `Transcript:\n${sourceText}`,
    )
    if (candidate === null) return null

    const validated = InferredContextSchema.safeParse(candidate)
    if (!validated.success) return null
    return validated.data
  }
}

// ---------------------------------------------------------------------------
// Response coercion (shared)
// ---------------------------------------------------------------------------

/**
 * Build an ExtractionResponse from an already-parsed object, leniently: a
 * missing `proposedDecisions` / `proposedActions` becomes an empty array, and a
 * single malformed item is dropped rather than failing the whole turn. Returns
 * null only when the value is not a JSON object at all (→ retry). This is a
 * deliberate softening of the strict all-or-nothing schema for LLM output: the
 * items are Proposed and reviewed by the note-taker, so keeping the valid ones
 * beats discarding a whole turn over one bad field.
 */
interface ExtractionDiagnostics {
  decisionsKept: number
  decisionsRaw: number
  actionsKept: number
  actionsRaw: number
  /** Dedup'd `decision.<field>` / `action.<field>` paths of dropped items. */
  droppedPaths: string[]
}

interface CoercedExtraction {
  response: ExtractionResponse
  diagnostics: ExtractionDiagnostics
}

export function coerceExtractionResponse(parsed: unknown): CoercedExtraction | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  const decisions = validateArray(obj.proposedDecisions, ProposedDecisionSchema)
  const actions = validateArray(obj.proposedActions, ProposedActionSchema)

  const response: ExtractionResponse = {
    proposedDecisions: decisions.items,
    proposedActions: actions.items,
  }

  // discussionSummaries is present only on the final pass; keep it out of the
  // object entirely when absent (exactOptionalPropertyTypes).
  if (obj.discussionSummaries !== undefined) {
    response.discussionSummaries = validateArray(
      obj.discussionSummaries,
      ProposedDiscussionSummarySchema,
    ).items
  }

  const droppedPaths = [
    ...new Set([
      ...decisions.droppedPaths.map((p) => `decision.${p}`),
      ...actions.droppedPaths.map((p) => `action.${p}`),
    ]),
  ]

  return {
    response,
    diagnostics: {
      decisionsKept: decisions.items.length,
      decisionsRaw: decisions.rawCount,
      actionsKept: actions.items.length,
      actionsRaw: actions.rawCount,
      droppedPaths,
    },
  }
}

interface ValidatedArray<T> {
  items: T[]
  /** How many elements the model returned (0 when the key was absent). */
  rawCount: number
  /** Field paths of the items that failed validation (no values). */
  droppedPaths: string[]
}

/** Validate each element against `schema`, keeping the valid ones and recording why the rest dropped. */
function validateArray<S extends z.ZodType>(
  value: unknown,
  schema: S,
): ValidatedArray<z.infer<S>> {
  if (!Array.isArray(value)) return { items: [], rawCount: 0, droppedPaths: [] }
  const items: z.infer<S>[] = []
  const droppedPaths: string[] = []
  for (const item of value) {
    const result = schema.safeParse(item)
    if (result.success) items.push(result.data)
    else droppedPaths.push(...result.error.issues.map((i) => i.path.join('.') || '(root)'))
  }
  return { items, rawCount: value.length, droppedPaths }
}

// ---------------------------------------------------------------------------
// Prompt builders (shared body) — never logged outside the devlog content opt-in
//
// The body is vendor-neutral: agenda, participants, language, schema. The one
// mechanism-specific sentence ("use the tool" vs "send JSON") is the wire's
// `extractInstruction` / `inferInstruction`, appended by the engine (ADR 0034).
// The body is the union of what the two families used to carry separately: the
// explicit primary-language instruction (was Anthropic-only) and the inline
// schema description (was OpenAI-only).
// ---------------------------------------------------------------------------

function buildExtractBody(request: ExtractionRequest): string {
  const agendaLines =
    request.agendaItems.length > 0
      ? request.agendaItems.map((a, i) => `${String(i + 1)}. ${a.title}`).join('\n')
      : '(geen agenda)'

  const participantNames =
    request.participants.length > 0
      ? request.participants.map((p) => p.name).join(', ')
      : '(geen deelnemers)'

  const summariesInstruction = request.isFinalPass
    ? `\n\nDit is de EINDEXTRACTIE. Voeg ook een "discussionSummaries" array toe met één object per agendapunt: { "agendaItemHint": "<exacte titel van het agendapunt hierboven>", "text": "korte samenvatting van wat er onder dat punt is besproken" }. Gebruik voor agendaItemHint de exacte titel uit de agenda; voor besproken zaken zonder agendapunt laat je agendaItemHint weg.`
    : ''

  return `Je bent een assistent die vergadernotities analyseert en beslissingen en actiepunten extraheert.

Primaire taal: ${request.primaryLanguage}
Geef alle tekst (rationale, description, text) terug in de primaire taal van de vergadering.
Agenda:\n${agendaLines}
Deelnemers: ${participantNames}${summariesInstruction}

Schema voor proposedDecisions items: { "rationale": string, "sourceSpanId": string, "agendaItemHint"?: string }
Schema voor proposedActions items: { "description": string, "sourceSpanId": string, "ownerHint"?: string, "agendaItemHint"?: string }`
}

function buildInferBody(knownAgendaItems: readonly { title: string; topic: string }[]): string {
  const grounding =
    knownAgendaItems.length === 0
      ? ''
      : `\n\nDe agenda bevat al deze punten:\n${knownAgendaItems
          .map((a) => `- ${a.title}: ${a.topic}`)
          .join(
            '\n',
          )}\nGeef alleen NIEUWE agendapunten terug die hier nog niet in staan; herhaal niets.`

  return `Je leidt de agenda, de deelnemers en een korte vergadertitel af uit de bron. Geef per agendapunt een korte title en topic.

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
