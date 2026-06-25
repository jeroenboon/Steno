/**
 * ExtractionProvider port — vendor-neutral one-shot extraction interface.
 *
 * The extraction loop (item 0008) calls extract() on every cadence tick and
 * once more on the final pass. Real implementations are cloud LLM adapters
 * (Anthropic in item 0010); fakes are used in all unit tests.
 *
 * isFinalPass distinguishes:
 *   - Rolling cadence call: extract decisions/actions from recent spans.
 *   - Final pass (MeetingEnded): same, but also produce per-Agenda-Item
 *     Discussion Summaries (see CONTEXT.md "Discussion Summary").
 *
 * ## Optional summary methods (item 0020)
 *
 * `summarise` and `query` are optional (?) so existing adapters need not
 * implement them — callers must guard with `provider.summarise !== undefined`
 * before calling. This avoids churn on adapters that only support extraction.
 * The trade-off: the caller must check capability at call site rather than
 * at construction time; this is acceptable because the live runtime already
 * has the null-scheduler degraded path and extends it naturally.
 */

import type { TranscriptSpan } from '../domain/types'

import type { ExtractionRequest, ExtractionResponse, InferredContext } from './dtos'

/**
 * Input to {@link ExtractionProvider.inferContext}.
 *
 * `source` is either free text (a pasted agenda in Draft) or transcript spans
 * (live tick or final pass). `knownAgendaItems` grounds the inference: when
 * present, the provider returns only topics the known agenda does not already
 * cover (append-only, used by the live agenda scheduler). See ADR 0029.
 */
export interface InferContextInput {
  source: { text: string } | { spans: TranscriptSpan[] }
  knownAgendaItems?: { title: string; topic: string }[]
}

/**
 * Flatten an {@link InferContextInput.source} to the plain text an extraction
 * adapter feeds the model. Free text passes through; spans render one line each
 * as `[id] Speaker: text` (the format both adapter families already used).
 */
export function inferSourceToText(source: InferContextInput['source']): string {
  if ('text' in source) return source.text
  return source.spans
    .map((s) => `[${s.id}] ${s.speakerLabel ? `${s.speakerLabel}: ` : ''}${s.text}`)
    .join('\n')
}

export interface ExtractionProvider {
  /**
   * Run one extraction turn.
   *
   * @param request — validated ExtractionRequest (spans, agenda, participants,
   *   language, and whether this is the final pass).
   * @returns A promise resolving to the provider's proposals. Never rejects
   *   under normal conditions; the extraction loop handles provider errors.
   */
  extract(request: ExtractionRequest): Promise<ExtractionResponse>

  /**
   * Produce a plain-text whole-meeting summary from the given transcript spans.
   * Returns a paragraph of plain text; no JSON, no structured data.
   * Optional — not all adapters implement this.
   *
   * @param spans — All final transcript spans accumulated so far.
   */
  summarise?(spans: TranscriptSpan[]): Promise<string>

  /**
   * Answer a free-form question grounded in the given transcript spans.
   * Returns a plain-text answer.
   * Optional — not all adapters implement this.
   *
   * @param spans    — All final transcript spans accumulated so far.
   * @param question — The note-taker's question in natural language.
   */
  query?(spans: TranscriptSpan[], question: string): Promise<string>

  /**
   * Infer Agenda Items, Participants and optionally a title from a source.
   *
   * Runs at three moments (ADR 0029): paste-time (text source, Draft), the live
   * agenda tick (spans + knownAgendaItems grounding, append-only), and the final
   * pass (spans over the whole transcript). With `knownAgendaItems` the provider
   * returns only uncovered topics. The live tick ignores `title` and
   * `participants`. Both lists may be empty when nothing could be inferred.
   *
   * Optional — callers must guard with `provider.inferContext !== undefined`
   * (same pattern as summarise/query). See ADR 0026 and ADR 0029.
   */
  inferContext?(input: InferContextInput): Promise<InferredContext>
}
