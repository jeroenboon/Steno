/**
 * ASR terminal-state DTO — the single source of truth for "streaming
 * transcription has stopped permanently and why" (audit finding C4).
 *
 * A streaming ASR socket can hit a wall that retrying never clears: a revoked or
 * invalid key (`auth`), or an endpoint that stays unreachable past the
 * consecutive-failure ceiling (`max-retries`). When that happens the stream
 * gives up, and the note-taker must SEE that live transcription stopped rather
 * than watch the transcript go silent.
 *
 * This schema is the boundary contract carried from the realtime transport
 * (`RealtimeSpanStream`) out through the `ASRProvider` port, over IPC, and into
 * the renderer's EgressIndicator. It carries ONLY the reason enum — never a key,
 * URL, or any transcript content (privacy, principle #11/#12).
 */

import { z } from 'zod'

/**
 * Why streaming transcription terminated permanently.
 * - `auth`        — a permanent authentication failure (revoked/invalid key):
 *                   retrying can never succeed.
 * - `max-retries` — too many consecutive connect failures with no working
 *                   session in between: the endpoint is unreachable.
 */
export const AsrTerminalReasonSchema = z.enum(['auth', 'max-retries'])

export type AsrTerminalReason = z.infer<typeof AsrTerminalReasonSchema>

/** The terminal state fired once by the ASR port when it gives up. */
export const AsrTerminalStateSchema = z.object({
  reason: AsrTerminalReasonSchema,
})

export type AsrTerminalState = z.infer<typeof AsrTerminalStateSchema>
