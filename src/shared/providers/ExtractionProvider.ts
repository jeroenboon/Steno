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

import type { ExtractionRequest, ExtractionResponse } from './dtos'

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
}
