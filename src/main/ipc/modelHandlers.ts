/**
 * Model IPC handlers (audit A2b): model:status/download (item 0024). Owns the
 * ModelOps port, satisfied by an object index.ts builds over ModelDownloader +
 * a webContents.send push.
 */

import {
  ModelStatusRequestSchema,
  ModelStatusResponseSchema,
  ModelDownloadRequestSchema,
  ModelDownloadResponseSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  ModelStatusResponse,
  ModelDownloadResponse,
  ModelProgressEvent,
} from '@shared/ipc'

import type { ModelDownloader } from '../providers/sherpa/ModelDownloader'

import type { Handler } from './handlerTypes'

/** Local ASR model download. */
export interface ModelOps {
  downloader: ModelDownloader
  /**
   * Push a model:progress event to the renderer. A property-typed function (not
   * a method signature) so the download handler can hold a reference to it
   * without tripping @typescript-eslint/unbound-method.
   */
  pushProgress: (evt: ModelProgressEvent) => void
}

export interface ModelHandlerDeps {
  model?: ModelOps
}

export function createModelHandlers(deps: ModelHandlerDeps): Partial<Record<IpcChannel, Handler>> {
  return {
    'model:status': (raw: unknown): ModelStatusResponse => {
      const req = ModelStatusRequestSchema.parse(raw)
      const downloaded = deps.model?.downloader.isDownloaded() ?? false
      return ModelStatusResponseSchema.parse({
        modelId: req.modelId,
        downloaded,
        sizeBytes: 0,
      })
    },
    'model:download': (raw: unknown): ModelDownloadResponse => {
      const req = ModelDownloadRequestSchema.parse(raw)

      if (deps.model === undefined) {
        throw new Error('model:download is not available — ModelDownloader not configured')
      }

      const downloader = deps.model.downloader
      const push = deps.model.pushProgress
      const modelId = req.modelId

      void downloader
        .download((received, total) => {
          push({ modelId, bytesReceived: received, bytesTotal: total, done: false })
        })
        .then(() => {
          push({ modelId, bytesReceived: 0, bytesTotal: 0, done: true })
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err)
          push({ modelId, bytesReceived: 0, bytesTotal: 0, done: true, error })
        })

      return ModelDownloadResponseSchema.parse({ ok: true })
    },
  }
}
