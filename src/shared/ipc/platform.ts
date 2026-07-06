/**
 * Platform side-effect IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Invoke channels: export:markdown, export:copyMarkdown, transcript:copy —
 * all backed by Electron-native effects (save dialog, clipboard) in main.
 */

import { z } from 'zod'

import type { IpcChannelSchema } from './common'

// ---------------------------------------------------------------------------
// export:markdown — save Markdown to a file chosen by the user (item 0022)
//
// Main shows a save dialog, writes the file, and returns ok/reason.
// The renderer generates the content string using the shared serializer.
// ---------------------------------------------------------------------------

export const ExportMarkdownRequestSchema = z.object({
  /** Pre-rendered Markdown content to write to disk. */
  content: z.string(),
})

export const ExportMarkdownResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])

export type ExportMarkdownRequest = z.infer<typeof ExportMarkdownRequestSchema>
export type ExportMarkdownResponse = z.infer<typeof ExportMarkdownResponseSchema>

// ---------------------------------------------------------------------------
// export:copyMarkdown — copy Markdown to the clipboard (item 0022)
// ---------------------------------------------------------------------------

export const ExportCopyMarkdownRequestSchema = z.object({
  /** Pre-rendered Markdown content to copy to the clipboard. */
  content: z.string(),
})

export const ExportCopyMarkdownResponseSchema = z.object({ ok: z.literal(true) })

export type ExportCopyMarkdownRequest = z.infer<typeof ExportCopyMarkdownRequestSchema>
export type ExportCopyMarkdownResponse = z.infer<typeof ExportCopyMarkdownResponseSchema>

// ---------------------------------------------------------------------------
// transcript:copy — copy the full transcript to the clipboard (item 0026)
//
// Main reads the meeting's persisted spans, serialises them to plain text, and
// copies the result. The transcript never round-trips to the renderer; only the
// meeting id is sent.
// ---------------------------------------------------------------------------

export const TranscriptCopyRequestSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
})

export const TranscriptCopyResponseSchema = z.object({ ok: z.literal(true) })

export type TranscriptCopyRequest = z.infer<typeof TranscriptCopyRequestSchema>
export type TranscriptCopyResponse = z.infer<typeof TranscriptCopyResponseSchema>

// ---------------------------------------------------------------------------
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type PlatformChannel = 'export:markdown' | 'export:copyMarkdown' | 'transcript:copy'

export const platformChannelSchemas = {
  'export:markdown': {
    request: ExportMarkdownRequestSchema,
    response: ExportMarkdownResponseSchema,
  },
  'export:copyMarkdown': {
    request: ExportCopyMarkdownRequestSchema,
    response: ExportCopyMarkdownResponseSchema,
  },
  'transcript:copy': {
    request: TranscriptCopyRequestSchema,
    response: TranscriptCopyResponseSchema,
  },
} satisfies Record<PlatformChannel, IpcChannelSchema>

export interface PlatformApi {
  /**
   * Save meeting notes as a Markdown file. Main shows a save dialog.
   * Returns ok=false with a reason if the dialog was cancelled or the write failed.
   * (item 0022)
   */
  exportMarkdown: (req: ExportMarkdownRequest) => Promise<ExportMarkdownResponse>
  /**
   * Copy meeting notes as Markdown to the clipboard.
   * (item 0022)
   */
  exportCopyMarkdown: (req: ExportCopyMarkdownRequest) => Promise<ExportCopyMarkdownResponse>
  /**
   * Copy the full transcript of a meeting to the clipboard (item 0026).
   * Main serialises the persisted spans; only the meeting id is sent.
   */
  transcriptCopy: (req: TranscriptCopyRequest) => Promise<TranscriptCopyResponse>
}
