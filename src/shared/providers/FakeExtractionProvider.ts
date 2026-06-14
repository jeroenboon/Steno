/**
 * FakeExtractionProvider — deterministic in-memory extraction for tests.
 *
 * Tests script responses via scriptRollingResponse() and scriptFinalPassResponse().
 * Rolling scripts are consumed in order (FIFO); once exhausted, the provider
 * returns an empty response. The final-pass script is used once when
 * isFinalPass=true. All calls are recorded for assertion.
 */

import type { ExtractionRequest, ExtractionResponse } from './dtos'
import type { ExtractionProvider } from './ExtractionProvider'

export class FakeExtractionProvider implements ExtractionProvider {
  private _rollingScripts: ExtractionResponse[] = []
  private _finalPassScript: ExtractionResponse | null = null
  private _calls: ExtractionRequest[] = []

  /**
   * Enqueue a scripted response for the next rolling (non-final-pass) call.
   * Responses are consumed FIFO; exhausted queue returns an empty response.
   */
  scriptRollingResponse(response: ExtractionResponse): void {
    this._rollingScripts.push(response)
  }

  /**
   * Set the scripted response for the final-pass call (isFinalPass=true).
   * Can only be scripted once; overwrites if called again.
   */
  scriptFinalPassResponse(response: ExtractionResponse): void {
    this._finalPassScript = response
  }

  /** Returns the number of extract() calls received so far. */
  callCount(): number {
    return this._calls.length
  }

  /** Returns all recorded extract() requests in call order. */
  calls(): readonly ExtractionRequest[] {
    return this._calls
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    this._calls.push(request)

    if (request.isFinalPass) {
      const script = this._finalPassScript ?? {
        proposedDecisions: [],
        proposedActions: [],
      }
      return Promise.resolve(script)
    }

    const script = this._rollingScripts.shift()
    if (script !== undefined) {
      // Strip discussionSummaries if somehow present — rolling calls never return them
      return Promise.resolve({
        proposedDecisions: script.proposedDecisions,
        proposedActions: script.proposedActions,
      })
    }

    return Promise.resolve({
      proposedDecisions: [],
      proposedActions: [],
    })
  }
}
