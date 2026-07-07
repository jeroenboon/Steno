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
export { AsrTerminalReasonSchema, AsrTerminalStateSchema } from './asrTerminalState'
export type { AsrTerminalReason, AsrTerminalState } from './asrTerminalState'
export { inferSourceToText } from './ExtractionProvider'
export type { ExtractionProvider, InferContextInput } from './ExtractionProvider'
export { ExtractionTerminalReasonSchema, ExtractionTerminalStateSchema } from './extractionTerminalState'
export type { ExtractionTerminalReason, ExtractionTerminalState } from './extractionTerminalState'
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
export { extractionPresets, localExtractionPresets } from './extractionPresets'
export type { LocalPreset } from './extractionPresets'
export { PROVIDER_KEY_HELP } from './providerKeyHelp'
export type { ProviderKeyHelpEntry } from './providerKeyHelp'
