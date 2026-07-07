/**
 * Extraction terminal-state DTO — the single source of truth for "live note
 * extraction has stopped permanently for this meeting and why" (ADR 0042).
 *
 * The sibling of the ASR terminal state (asrTerminalState.ts), on the extraction
 * side. It fires when the Extraction Provider returns TRUNCATED output
 * (OpenAI-compatible `finish_reason: "length"` / Anthropic
 * `stop_reason: "max_tokens"`): the model ran out of its budget mid-answer, so
 * the result cannot be trusted. A single occurrence stops all live LLM
 * interpretation for the meeting — rolling cadence, agenda inference, and the
 * automatic final pass — because a model that truncates once would put
 * unreliable content into the notes, and the invariant is no wrong content in
 * the report. The transcript keeps recording (ASR is independent).
 *
 * This schema is the boundary contract carried from the extraction wire out
 * through the `ExtractionProvider` port, over IPC, and into the renderer's
 * EgressIndicator. It carries ONLY the reason enum — never a key, prompt, or any
 * transcript content (privacy, principle #11/#12).
 */

import { z } from 'zod'

/**
 * Why live note extraction terminated permanently.
 * - `output-truncated` — the model's response was cut off mid-answer
 *   (`finish_reason: "length"` / `stop_reason: "max_tokens"`), so its output is
 *   unreliable. Names the observation, not the conclusion; the UI copy
 *   interprets it ("het gekozen model lijkt niet geschikt voor live-extractie").
 */
export const ExtractionTerminalReasonSchema = z.enum(['output-truncated'])

export type ExtractionTerminalReason = z.infer<typeof ExtractionTerminalReasonSchema>

/** The terminal state fired once by the extraction port when it gives up. */
export const ExtractionTerminalStateSchema = z.object({
  reason: ExtractionTerminalReasonSchema,
})

export type ExtractionTerminalState = z.infer<typeof ExtractionTerminalStateSchema>
