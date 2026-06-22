/**
 * FakeExtractionProvider — deterministic in-memory extraction for tests.
 *
 * Tests script responses via scriptRollingResponse() and scriptFinalPassResponse().
 * Rolling scripts are consumed in order (FIFO); once exhausted, the provider
 * returns an empty response. The final-pass script is used once when
 * isFinalPass=true. All calls are recorded for assertion.
 *
 * Also implements optional summarise() and query() (item 0020):
 *   - scriptSummariseResponse(text) sets the scripted summary string.
 *   - scriptQueryResponse(text) sets the scripted query answer.
 *   - Both default to a predictable deterministic string when not scripted.
 */

import type { TranscriptSpan } from '../domain/types'

import type { ExtractionRequest, ExtractionResponse, InferredContext } from './dtos'
import type { ExtractionProvider } from './ExtractionProvider'

export class FakeExtractionProvider implements ExtractionProvider {
  private _rollingScripts: ExtractionResponse[] = []
  private _finalPassScript: ExtractionResponse | null = null
  private _calls: ExtractionRequest[] = []
  private _summariseResponse: string | null = null
  private _queryResponse: string | null = null
  private _summariseCalls: TranscriptSpan[][] = []
  private _queryCalls: { spans: TranscriptSpan[]; question: string }[] = []
  private _inferContextResponse: InferredContext | null = null
  private _inferContextCalls: TranscriptSpan[][] = []

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

  /** Set the scripted summary returned by summarise(). */
  scriptSummariseResponse(text: string): void {
    this._summariseResponse = text
  }

  /** Set the scripted answer returned by query(). */
  scriptQueryResponse(text: string): void {
    this._queryResponse = text
  }

  /** Set the scripted context returned by inferContext(). */
  scriptInferContextResponse(context: InferredContext): void {
    this._inferContextResponse = context
  }

  /** Returns all recorded inferContext() calls in order. */
  inferContextCalls(): readonly TranscriptSpan[][] {
    return this._inferContextCalls
  }

  /** Returns the number of extract() calls received so far. */
  callCount(): number {
    return this._calls.length
  }

  /** Returns all recorded extract() requests in call order. */
  calls(): readonly ExtractionRequest[] {
    return this._calls
  }

  /** Returns all recorded summarise() calls in order. */
  summariseCalls(): readonly TranscriptSpan[][] {
    return this._summariseCalls
  }

  /** Returns all recorded query() calls in order. */
  queryCalls(): readonly { spans: TranscriptSpan[]; question: string }[] {
    return this._queryCalls
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

  summarise(spans: TranscriptSpan[]): Promise<string> {
    this._summariseCalls.push(spans)
    return Promise.resolve(
      this._summariseResponse ?? `Fake samenvatting voor ${String(spans.length)} fragmenten.`,
    )
  }

  query(spans: TranscriptSpan[], question: string): Promise<string> {
    this._queryCalls.push({ spans, question })
    return Promise.resolve(
      this._queryResponse ?? `Fake antwoord op "${question}" (${String(spans.length)} fragmenten).`,
    )
  }

  inferContext(spans: TranscriptSpan[]): Promise<InferredContext> {
    this._inferContextCalls.push(spans)
    return Promise.resolve(this._inferContextResponse ?? { agendaItems: [], participants: [] })
  }
}
