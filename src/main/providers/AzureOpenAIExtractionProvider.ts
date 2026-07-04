/**
 * AzureOpenAIExtractionProvider (Phase 2.1).
 *
 * An ExtractionProvider adapter for Azure OpenAI deployments. Azure speaks the
 * same chat-completions wire as OpenAI, so the transport is shared via
 * OpenAiJsonWire (openAiJsonWire.ts) and the prompt/coerce/retry contract via
 * the vendor-neutral ExtractionEngine (extractionEngine.ts). Azure differs only
 * in:
 *   - URL: {endpoint}/openai/deployments/{deployment}/chat/completions
 *          ?api-version={apiVersion}
 *   - Auth: the `api-key` header (not `Authorization: Bearer`)
 *
 * ## Privacy (principle #12)
 * The API key is injected (never read from disk here). It is passed in the
 * `api-key` header and is never logged; logs carry the `displayName` tag only.
 *
 * ## Constructor params
 * - `apiKey`      — Raw API key for the Azure resource. Injected by the factory.
 * - `endpoint`    — Azure resource endpoint, e.g. https://x.openai.azure.com/
 * - `deployment`  — Deployment name, e.g. my-gpt-4o-deployment
 * - `apiVersion`  — Azure API version, e.g. 2024-12-01-preview
 * - `model`       — Model identifier sent in the request body.
 * - `displayName` — Shown in logs (non-sensitive) and egress disclosure.
 * - `fetch`       — Injected for testability. Defaults to global fetch.
 */

import type {
  ExtractionProvider,
  ExtractionRequest,
  ExtractionResponse,
  InferContextInput,
  InferredContext,
} from '@shared/providers'

import { ExtractionEngine } from './extractionEngine'
import { OpenAiJsonWire } from './openAiJsonWire'

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface AzureOpenAIExtractionProviderOptions {
  apiKey: string
  endpoint: string
  deployment: string
  apiVersion: string
  model: string
  displayName: string
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AzureOpenAIExtractionProvider implements ExtractionProvider {
  private readonly _engine: ExtractionEngine

  constructor(opts: AzureOpenAIExtractionProviderOptions) {
    const endpoint = opts.endpoint.replace(/\/$/, '') // strip trailing slash
    const url =
      `${endpoint}/openai/deployments/${opts.deployment}/chat/completions` +
      `?api-version=${opts.apiVersion}`
    const logTag = `[${opts.displayName}]`

    const wire = new OpenAiJsonWire({
      model: opts.model,
      logTag,
      target: {
        url,
        headers: {
          'Content-Type': 'application/json',
          'api-key': opts.apiKey,
        },
      },
      fetch: opts.fetch ?? globalThis.fetch,
    })

    this._engine = new ExtractionEngine({ wire, logTag, model: opts.model })
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    return this._engine.extract(request)
  }

  /**
   * Infer Agenda Items and Participants from a whole transcript for an Imported
   * Meeting where the user did not supply them (item 0026). Degrades to an empty
   * context rather than throwing into the import.
   */
  async inferContext(input: InferContextInput): Promise<InferredContext> {
    return this._engine.inferContext(input)
  }
}
