/**
 * Audio-file import IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Invoke channels: import:start, import:finish, context:inferFromText.
 * One-way: import:frame (renderer → main decoded PCM). Push: import:progress.
 */

import { z } from 'zod'

import { InferredContextSchema } from '../providers'

import type { IpcChannelSchema, UnsubscribeFn } from './common'

// ---------------------------------------------------------------------------
// import:start — create an imported meeting and begin offline transcription
// (item 0026)
//
// Main generates the meeting id, persists the meeting (state 'live', source
// 'import'), builds the ASR provider, and starts draining spans. The renderer
// then streams decoded PCM frames via the import:frame one-way channel.
// ---------------------------------------------------------------------------

export const ImportStartRequestSchema = z.object({
  title: z.string().min(1, 'Meeting title cannot be empty'),
  primaryLanguage: z.string().min(1, 'Primary language cannot be empty'),
  /** Agenda items the user typed; empty when inferring. */
  agendaItems: z.array(z.object({ title: z.string().min(1), topic: z.string().min(1) })),
  /** Participants the user typed; empty when inferring. */
  participants: z.array(z.object({ name: z.string().min(1) })),
  /** When true, infer agenda + participants from the transcript before the final pass. */
  inferContext: z.boolean(),
})

export const ImportStartResponseSchema = z.object({
  /** The id of the newly created imported meeting. */
  meetingId: z.string().min(1),
})

export type ImportStartRequest = z.infer<typeof ImportStartRequestSchema>
export type ImportStartResponse = z.infer<typeof ImportStartResponseSchema>

// ---------------------------------------------------------------------------
// import:finish — signal end-of-file: stop transcription, infer (if asked),
// run the final pass, and mark the meeting Ended (item 0026)
// ---------------------------------------------------------------------------

export const ImportFinishRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})

export const ImportFinishResponseSchema = z.object({
  meetingId: z.string().min(1),
})

export type ImportFinishRequest = z.infer<typeof ImportFinishRequestSchema>
export type ImportFinishResponse = z.infer<typeof ImportFinishResponseSchema>

// ---------------------------------------------------------------------------
// import:progress — main → renderer push event (item 0026)
//
// Coarse stage transitions for the import pipeline. The renderer owns the
// decode/stream percentage; main emits these stage changes. Validated
// renderer-side per principle #8.
// ---------------------------------------------------------------------------

export const ImportProgressEventSchema = z.object({
  stage: z.enum(['transcribing', 'inferring', 'extracting', 'done', 'error']),
  /** Optional 0–100 progress hint for the current stage. */
  percent: z.number().optional(),
  /** Set when stage is 'error'. */
  error: z.string().optional(),
})

export type ImportProgressEvent = z.infer<typeof ImportProgressEventSchema>

// ---------------------------------------------------------------------------
// context:inferFromText — structure a pasted agenda into title + agenda items
// + participants (paste-an-agenda, ADR 0029)
//
// The user pastes free text in Draft; main builds the extraction provider and
// calls inferContext({ source: { text } }). The resulting items fill the
// editable Draft fields as Confirmed items (pasting is an input method, not
// agent inference). Degrades to an empty context when no extraction provider is
// configured, so manual entry still works.
// ---------------------------------------------------------------------------

export const ContextInferFromTextRequestSchema = z.object({
  /** The raw text the user pasted (an agenda from Word/Markdown/anything). */
  text: z.string().min(1, 'Text cannot be empty'),
  /** The primary language for inference (e.g. 'nl', 'en'). */
  primaryLanguage: z.string().min(1, 'Primary language cannot be empty'),
})

export const ContextInferFromTextResponseSchema = InferredContextSchema

export type ContextInferFromTextRequest = z.infer<typeof ContextInferFromTextRequestSchema>
export type ContextInferFromTextResponse = z.infer<typeof ContextInferFromTextResponseSchema>

// ---------------------------------------------------------------------------
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type ImportChannel = 'import:start' | 'import:finish' | 'context:inferFromText'

export const importChannelSchemas = {
  'import:start': { request: ImportStartRequestSchema, response: ImportStartResponseSchema },
  'import:finish': { request: ImportFinishRequestSchema, response: ImportFinishResponseSchema },
  'context:inferFromText': {
    request: ContextInferFromTextRequestSchema,
    response: ContextInferFromTextResponseSchema,
  },
} satisfies Record<ImportChannel, IpcChannelSchema>

/** One-way channel: renderer streams decoded PCM frames for the active import. */
export type ImportOnewayChannel = 'import:frame'

export interface ImportApi {
  /**
   * Start an audio-file import (item 0026). Main creates the meeting and begins
   * offline transcription; the renderer then streams decoded PCM frames via
   * importSendFrame and calls importFinish at end-of-file. Returns the new
   * meeting id.
   */
  importStart: (req: ImportStartRequest) => Promise<ImportStartResponse>
  /**
   * Send a decoded PCM frame (Int16 LE, Uint8Array) for the active import
   * (item 0026). Fire-and-forget: no response. Uses ipcRenderer.send.
   */
  importSendFrame: (frame: Uint8Array) => void
  /**
   * Signal end-of-file for the active import (item 0026). Main stops
   * transcription, optionally infers context, runs the final pass, and marks the
   * meeting Ended. Returns the meeting id so the renderer can open it in Review.
   */
  importFinish: (req: ImportFinishRequest) => Promise<ImportFinishResponse>
  /**
   * Subscribe to import progress events pushed from main (item 0026).
   * Reports coarse stage transitions; stage 'done' signals completion and
   * 'error' carries a reason. Returns an unsubscribe function.
   */
  onImportProgress: (cb: (evt: ImportProgressEvent) => void) => UnsubscribeFn
  /**
   * Structure a pasted agenda into title + agenda items + participants
   * (paste-an-agenda, ADR 0029). Main calls inferContext over the text; the
   * Draft fields fill with the result as Confirmed items. Returns an empty
   * context when no extraction provider is configured.
   */
  inferContextFromText: (req: ContextInferFromTextRequest) => Promise<ContextInferFromTextResponse>
}
