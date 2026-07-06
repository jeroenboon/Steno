/**
 * Platform IPC handlers (audit A2b): export:markdown/copyMarkdown, transcript:copy
 * (item 0022/0026). Owns the PlatformOps port — the Electron-native side effects
 * (save dialog, clipboard, transcript read) the pure registry cannot perform
 * itself. Built in index.ts over `dialog` / `clipboard` / MeetingQueryService.
 */

import {
  ExportMarkdownRequestSchema,
  ExportCopyMarkdownRequestSchema,
  ExportCopyMarkdownResponseSchema,
  TranscriptCopyRequestSchema,
  TranscriptCopyResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  ExportMarkdownResponse,
  ExportCopyMarkdownResponse,
  TranscriptCopyResponse,
} from '@shared/ipc'

import type { Handler } from './handlerTypes'

/**
 * Electron-native side effects the pure registry cannot perform itself: the save
 * dialog, the clipboard, and reading + copying a meeting's transcript. Built in
 * index.ts over `dialog` / `clipboard` / `MeetingQueryService`.
 */
export interface PlatformOps {
  /** Save content to a user-chosen file (export:markdown). */
  exportFile(opts: {
    content: string
    defaultFilename: string
    filters: { name: string; extensions: string[] }[]
  }): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Copy content to the clipboard (export:copyMarkdown). */
  copyToClipboard(content: string): void
  /** Copy a meeting's full transcript to the clipboard (transcript:copy). */
  copyTranscript(meetingId: string): void
}

export interface PlatformHandlerDeps {
  platform?: PlatformOps
}

export function createPlatformHandlers(
  deps: PlatformHandlerDeps,
): Partial<Record<IpcChannel, Handler>> {
  return {
    'export:markdown': async (raw: unknown): Promise<ExportMarkdownResponse> => {
      const req = ExportMarkdownRequestSchema.parse(raw)
      if (deps.platform === undefined) {
        return { ok: false, reason: 'not available' }
      }
      return deps.platform.exportFile({
        content: req.content,
        defaultFilename: 'notulen.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
    },
    'export:copyMarkdown': (raw: unknown): ExportCopyMarkdownResponse => {
      const req = ExportCopyMarkdownRequestSchema.parse(raw)
      deps.platform?.copyToClipboard(req.content)
      return ExportCopyMarkdownResponseSchema.parse({ ok: true })
    },
    'transcript:copy': (raw: unknown): TranscriptCopyResponse => {
      const req = TranscriptCopyRequestSchema.parse(raw)
      deps.platform?.copyTranscript(req.meetingId)
      return TranscriptCopyResponseSchema.parse({ ok: true })
    },
  }
}
