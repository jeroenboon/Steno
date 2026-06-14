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
 */

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
}
