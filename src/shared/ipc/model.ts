/**
 * Local ASR model IPC contract (barrel-composed — see ../ipc.ts).
 *
 * Invoke channels: model:status, model:download. Push: model:progress.
 */

import { z } from 'zod'

import type { IpcChannelSchema, UnsubscribeFn } from './common'

// ---------------------------------------------------------------------------
// model:status — check whether the local ASR model is already downloaded
// (item 0024)
// ---------------------------------------------------------------------------

export const ModelStatusRequestSchema = z.object({ modelId: z.string().min(1) })
export const ModelStatusResponseSchema = z.object({
  modelId: z.string(),
  downloaded: z.boolean(),
  sizeBytes: z.number(),
})

export type ModelStatusRequest = z.infer<typeof ModelStatusRequestSchema>
export type ModelStatusResponse = z.infer<typeof ModelStatusResponseSchema>

// ---------------------------------------------------------------------------
// model:download — start a download; progress is pushed as model:progress
// (item 0024)
// ---------------------------------------------------------------------------

export const ModelDownloadRequestSchema = z.object({ modelId: z.string().min(1) })
export const ModelDownloadResponseSchema = z.object({ ok: z.literal(true) })

export type ModelDownloadRequest = z.infer<typeof ModelDownloadRequestSchema>
export type ModelDownloadResponse = z.infer<typeof ModelDownloadResponseSchema>

// ---------------------------------------------------------------------------
// model:progress — main → renderer push event (item 0024)
//
// Emitted during a model download. `done: true` signals completion.
// `error` is set when the download failed.
// ---------------------------------------------------------------------------

export interface ModelProgressEvent {
  modelId: string
  bytesReceived: number
  bytesTotal: number
  done: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Channel fragment + schema slice + API fragment
// ---------------------------------------------------------------------------

export type ModelChannel = 'model:status' | 'model:download'

export const modelChannelSchemas = {
  'model:status': { request: ModelStatusRequestSchema, response: ModelStatusResponseSchema },
  'model:download': { request: ModelDownloadRequestSchema, response: ModelDownloadResponseSchema },
} satisfies Record<ModelChannel, IpcChannelSchema>

export interface ModelApi {
  /**
   * Check whether the local ASR model is already downloaded (item 0024).
   * Returns { downloaded: true, sizeBytes } if present; { downloaded: false, sizeBytes: 0 } otherwise.
   */
  modelStatus: (req: ModelStatusRequest) => Promise<ModelStatusResponse>
  /**
   * Start downloading the local ASR model (item 0024).
   * Returns ok immediately; progress is pushed via onModelProgress events.
   */
  modelDownload: (req: ModelDownloadRequest) => Promise<ModelDownloadResponse>
  /**
   * Subscribe to model download progress events pushed from main (item 0024).
   * Fired during a model:download. done=true signals completion; error is set on failure.
   * Returns an unsubscribe function.
   */
  onModelProgress: (cb: (evt: ModelProgressEvent) => void) => UnsubscribeFn
}
