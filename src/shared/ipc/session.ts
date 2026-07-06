/**
 * Live-session IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Invoke channels: audio:start, audio:stop, summary:query, meeting:end,
 * meeting:pause, meeting:resume.
 * One-way: audio:frame (renderer → main PCM). Push events: transcript:span,
 * summary:changed, asr:terminal.
 */

import { z } from 'zod'

import { MeetingSchema } from '../domain'
import { AsrTerminalReasonSchema } from '../providers'

import type { IpcChannelSchema, UnsubscribeFn } from './common'

// ---------------------------------------------------------------------------
// audio:start — tell main to open an ASR session (item 0015)
// ---------------------------------------------------------------------------

export const AudioStartRequestSchema = z.object({ meetingId: z.string().min(1) })
export const AudioStartResponseSchema = z.object({ ok: z.literal(true) })

export type AudioStartRequest = z.infer<typeof AudioStartRequestSchema>
export type AudioStartResponse = z.infer<typeof AudioStartResponseSchema>

// ---------------------------------------------------------------------------
// audio:stop — tell main to close the active ASR session (item 0015)
// ---------------------------------------------------------------------------

export const AudioStopRequestSchema = z.object({})
export const AudioStopResponseSchema = z.object({ ok: z.literal(true) })

export type AudioStopRequest = z.infer<typeof AudioStopRequestSchema>
export type AudioStopResponse = z.infer<typeof AudioStopResponseSchema>

// ---------------------------------------------------------------------------
// transcript:span — main → renderer event (item 0015)
//
// NOT an invoke channel. Main pushes spans via webContents.send; the preload
// exposes onTranscriptSpan(cb) / offTranscriptSpan(cb) for the renderer.
// We validate the incoming payload with this schema on the renderer side.
// ---------------------------------------------------------------------------

export { TranscriptSpanSchema } from '../domain/types'
export type { TranscriptSpan } from '../domain/types'

// ---------------------------------------------------------------------------
// summary:changed — main → renderer push event (item 0020)
//
// Emitted after each extraction cadence tick fires the summarise() call on the
// provider. Carries the latest whole-meeting plain-text running summary.
// The renderer replaces its local summary string on each event.
//
// Pattern: webContents.send('summary:changed', payload) on main;
//          ipcRenderer.on('summary:changed', listener) in preload, exposed as
//          window.api.onSummaryChanged(cb) returning an UnsubscribeFn.
// ---------------------------------------------------------------------------

export const SummaryChangedPayloadSchema = z.object({
  /** The latest whole-meeting running summary as plain text. */
  summary: z.string(),
})

export type SummaryChangedPayload = z.infer<typeof SummaryChangedPayloadSchema>

// ---------------------------------------------------------------------------
// asr:terminal — main → renderer push event (audit finding C4)
//
// Emitted when a streaming ASR session terminates permanently (a revoked/invalid
// key → 'auth', or the reconnect ceiling → 'max-retries'), so the always-visible
// EgressIndicator can tell the note-taker that live transcription stopped and
// why — instead of the transcript just going silent. `reason: null` clears the
// state: main emits it when a NEW live session starts, so a stale error from a
// prior meeting never lingers.
//
// Privacy (principle #11): the payload carries ONLY the reason enum — never a
// key, a URL with credentials, or any transcript content.
//
// Pattern: webContents.send('asr:terminal', payload) on main (from the live
//          runtime); ipcRenderer.on('asr:terminal', listener) in preload,
//          exposed as window.api.onAsrTerminal(cb) returning an UnsubscribeFn.
// ---------------------------------------------------------------------------

export const AsrTerminalPayloadSchema = z.object({
  /** The terminal reason, or null to clear the state (new session started). */
  reason: AsrTerminalReasonSchema.nullable(),
})

export type AsrTerminalPayload = z.infer<typeof AsrTerminalPayloadSchema>

// ---------------------------------------------------------------------------
// summary:query — invoke channel (item 0020)
//
// The note-taker asks a free-form question grounded in the current transcript.
// Main calls provider.query() and returns a plain-text answer.
// If the provider has no query() method, returns { answer: '' }.
// ---------------------------------------------------------------------------

export const SummaryQueryRequestSchema = z.object({
  question: z.string().min(1, 'Question cannot be empty'),
})

export const SummaryQueryResponseSchema = z.object({
  answer: z.string(),
})

export type SummaryQueryRequest = z.infer<typeof SummaryQueryRequestSchema>
export type SummaryQueryResponse = z.infer<typeof SummaryQueryResponseSchema>

// ---------------------------------------------------------------------------
// meeting:end — end the active meeting, triggering the final extraction pass
// (item 0021)
// ---------------------------------------------------------------------------

export const MeetingEndRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})

export const MeetingEndResponseSchema = z.object({ ok: z.literal(true) })

export type MeetingEndRequest = z.infer<typeof MeetingEndRequestSchema>
export type MeetingEndResponse = z.infer<typeof MeetingEndResponseSchema>

// ---------------------------------------------------------------------------
// meeting:pause / meeting:resume — pause is a sub-state within Live (the same
// transcript continues after resume). Halts the live cadence (runtime.pause).
// ---------------------------------------------------------------------------

export const MeetingPauseRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})
export const MeetingPauseResponseSchema = MeetingSchema

export type MeetingPauseRequest = z.infer<typeof MeetingPauseRequestSchema>
export type MeetingPauseResponse = z.infer<typeof MeetingPauseResponseSchema>

export const MeetingResumeRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})
export const MeetingResumeResponseSchema = MeetingSchema

export type MeetingResumeRequest = z.infer<typeof MeetingResumeRequestSchema>
export type MeetingResumeResponse = z.infer<typeof MeetingResumeResponseSchema>

// ---------------------------------------------------------------------------
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type SessionChannel =
  | 'audio:start'
  | 'audio:stop'
  | 'summary:query'
  | 'meeting:end'
  | 'meeting:pause'
  | 'meeting:resume'

export const sessionChannelSchemas = {
  'audio:start': { request: AudioStartRequestSchema, response: AudioStartResponseSchema },
  'audio:stop': { request: AudioStopRequestSchema, response: AudioStopResponseSchema },
  'summary:query': { request: SummaryQueryRequestSchema, response: SummaryQueryResponseSchema },
  'meeting:end': { request: MeetingEndRequestSchema, response: MeetingEndResponseSchema },
  'meeting:pause': { request: MeetingPauseRequestSchema, response: MeetingPauseResponseSchema },
  'meeting:resume': { request: MeetingResumeRequestSchema, response: MeetingResumeResponseSchema },
} satisfies Record<SessionChannel, IpcChannelSchema>

/** One-way channel: renderer streams PCM frames to main (no response). */
export type SessionOnewayChannel = 'audio:frame'

export interface SessionApi {
  /**
   * Tell main to open an ASR session. Call before sending audio frames.
   * (item 0015)
   */
  audioStart: (req: AudioStartRequest) => Promise<AudioStartResponse>
  /**
   * Tell main to close the active ASR session.
   * (item 0015)
   */
  audioStop: () => Promise<AudioStopResponse>
  /**
   * Send a raw PCM audio frame (Int16 LE, Uint8Array) to main.
   * Fire-and-forget: no response. Uses ipcRenderer.send, not invoke.
   * (item 0015)
   */
  audioSendFrame: (frame: Uint8Array) => void
  /**
   * Subscribe to transcript spans pushed from main.
   * Returns an unsubscribe function.
   * (item 0015)
   */
  onTranscriptSpan: (cb: (span: import('../domain/types').TranscriptSpan) => void) => UnsubscribeFn
  /**
   * Subscribe to running summary updates pushed from main (item 0020).
   * Fired after each extraction cadence tick when summarise() produces a result.
   * The callback receives the full current running summary string; the UI
   * replaces its local summary text on each event.
   * Returns an unsubscribe function.
   */
  onSummaryChanged: (cb: (payload: SummaryChangedPayload) => void) => UnsubscribeFn
  /**
   * Subscribe to ASR terminal-state events pushed from main (audit C4).
   * Fired when live transcription stops permanently (`auth` / `max-retries`),
   * and with `reason: null` when a new session starts (clears the state). The UI
   * shows the stop reason on the EgressIndicator. Returns an unsubscribe function.
   */
  onAsrTerminal: (cb: (payload: AsrTerminalPayload) => void) => UnsubscribeFn
  /**
   * Ask a free-form question grounded in the current transcript (item 0020).
   * Main calls provider.query() and returns a plain-text answer.
   * Returns { answer: '' } if the provider has no query capability.
   */
  summaryQuery: (req: SummaryQueryRequest) => Promise<SummaryQueryResponse>
  /**
   * End the active meeting. Triggers the final extraction pass (Discussion
   * Summaries, final decisions/actions) and stops the runtime (item 0021).
   */
  meetingEnd: (req: MeetingEndRequest) => Promise<MeetingEndResponse>
  /** Pause a Live meeting (sub-state within Live; halts the live cadence). */
  meetingPause: (req: MeetingPauseRequest) => Promise<MeetingPauseResponse>
  /** Resume a paused Live meeting; the same transcript continues. */
  meetingResume: (req: MeetingResumeRequest) => Promise<MeetingResumeResponse>
}
