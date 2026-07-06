/**
 * Import IPC handlers (audit A2b): import:start/finish and context:inferFromText
 * (item 0026, ADR 0029). Owns the ImportOps port, satisfied by an object index.ts
 * builds over ImportSessionController + the extraction provider.
 */

import {
  ImportStartRequestSchema,
  ImportStartResponseSchema,
  ImportFinishRequestSchema,
  ContextInferFromTextRequestSchema,
  ContextInferFromTextResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  ImportStartRequest,
  ImportStartResponse,
  ImportFinishResponse,
  ContextInferFromTextRequest,
  ContextInferFromTextResponse,
} from '@shared/ipc'

import type { Handler } from './handlerTypes'

/** Audio-file import. Satisfied by an object index.ts builds over ImportSessionController. */
export interface ImportOps {
  /** Start an import; returns the new meeting id (import:start). */
  start(req: ImportStartRequest): string
  /** Finish the import: transcribe, infer, final pass, mark Ended (import:finish). */
  finish(meetingId: string): Promise<ImportFinishResponse>
  /** Structure a pasted agenda into title + agenda items + participants (context:inferFromText). */
  inferFromText(req: ContextInferFromTextRequest): Promise<ContextInferFromTextResponse>
}

export interface ImportHandlerDeps {
  import?: ImportOps
}

export function createImportHandlers(
  deps: ImportHandlerDeps,
): Partial<Record<IpcChannel, Handler>> {
  return {
    'import:start': (raw: unknown): ImportStartResponse => {
      const req = ImportStartRequestSchema.parse(raw)
      if (deps.import === undefined) {
        throw new Error('import:start is not available')
      }
      const meetingId = deps.import.start(req)
      return ImportStartResponseSchema.parse({ meetingId })
    },
    'import:finish': async (raw: unknown): Promise<ImportFinishResponse> => {
      const req = ImportFinishRequestSchema.parse(raw)
      if (deps.import === undefined) {
        throw new Error('import:finish is not available')
      }
      return deps.import.finish(req.meetingId)
    },
    'context:inferFromText': async (raw: unknown): Promise<ContextInferFromTextResponse> => {
      const req = ContextInferFromTextRequestSchema.parse(raw)
      // Degrade gracefully: no import group wired ⇒ empty context, so the Draft
      // screen keeps manual entry working (ADR 0029).
      if (deps.import === undefined) {
        return ContextInferFromTextResponseSchema.parse({ agendaItems: [], participants: [] })
      }
      const result = await deps.import.inferFromText(req)
      return ContextInferFromTextResponseSchema.parse(result)
    },
  }
}
