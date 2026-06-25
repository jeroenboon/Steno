/**
 * Public surface of the providers module (item 0005).
 *
 * Exports:
 *  - ASRProvider interface
 *  - ExtractionProvider interface
 *  - Boundary DTOs (Zod schemas + inferred types)
 *  - Clock abstraction (RealClock + FakeClock)
 *  - FakeASRProvider and FakeExtractionProvider for deterministic tests
 */

export type { ASRProvider } from './ASRProvider'
export { inferSourceToText } from './ExtractionProvider'
export type { ExtractionProvider, InferContextInput } from './ExtractionProvider'
export { FakeASRProvider } from './FakeASRProvider'
export { FakeExtractionProvider } from './FakeExtractionProvider'
export { FakeClock, RealClock } from './clock'
export type { Clock } from './clock'
export {
  ExtractionRequestSchema,
  ExtractionResponseSchema,
  InferredContextSchema,
  ProposedActionSchema,
  ProposedDecisionSchema,
  ProposedDiscussionSummarySchema,
} from './dtos'
export type {
  ExtractionRequest,
  ExtractionResponse,
  InferredContext,
  ProposedAction,
  ProposedDecision,
  ProposedDiscussionSummary,
} from './dtos'
export { extractionPresets } from './extractionPresets'
export { PROVIDER_KEY_HELP } from './providerKeyHelp'
export type { ProviderKeyHelpEntry } from './providerKeyHelp'
