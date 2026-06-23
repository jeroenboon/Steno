/**
 * EgressState + disclosure copy (item 0012).
 *
 * Per ADR 0003: the app must always be explicit about what data leaves the
 * device and to whom. EgressState is a pure data type derived from AppSettings
 * that answers two questions:
 *
 *   - `audio`: does audio leave the device, and if so, to whom?
 *   - `notes`: does transcript text leave the device, and if so, to whom?
 *
 * EgressState is:
 *   - A pure function of settings (no side effects, no secrets)
 *   - Serialisable to JSON and safe to send over IPC to the renderer
 *   - The authoritative input for the EgressIndicator UI component (item 0013)
 *   - The basis for point-of-choice disclosure copy
 *
 * ## Naming convention
 *
 * `audio` and `notes` use a tagged-union string form:
 *   - `'local'`                   — data stays on the device
 *   - `'cloud:Deepgram'`          — sent to Deepgram
 *   - `'cloud:Anthropic'`         — sent to Anthropic
 *   - `'cloud:custom:<name>'`     — sent to a custom endpoint (display name embedded)
 *
 * Embedding the name in the string keeps the type simple and renders directly.
 */

import type { AppSettings } from './settingsSchema'

// ---------------------------------------------------------------------------
// EgressState type
// ---------------------------------------------------------------------------

/**
 * Audio egress is either local (stays on device) or cloud (sent to a named provider).
 * Using a tagged union string allows types like 'local' | `cloud:${string}`.
 */
export type AudioEgress = 'local' | `cloud:${string}`

/**
 * Notes egress is always cloud (sent to a named provider).
 * Display names are embedded for custom endpoints; vendor names for standard providers.
 */
export type NotesEgress = `cloud:${string}`

export interface EgressState {
  /** What happens to audio captured on this device. */
  audio: AudioEgress
  /** What happens to transcript text extracted on this device. */
  notes: NotesEgress
}

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

/**
 * Compute the current egress state from settings.
 *
 * Pure function: no I/O, no secrets, no logging. Safe to call in tests and
 * in the renderer (via IPC payload serialisation).
 */
export function computeEgressState(settings: AppSettings): EgressState {
  const audio = computeAudioEgress(settings)
  const notes = computeNotesEgress(settings)
  return { audio, notes }
}

function computeAudioEgress(settings: AppSettings): AudioEgress {
  switch (settings.asrProvider) {
    case 'local-parakeet':
      return 'local'
    case 'deepgram':
      return 'cloud:Deepgram'
    case 'openai-audio':
      return 'cloud:OpenAI'
    case 'mistral-voxtral':
      return 'cloud:Mistral'
    case 'azure-speech':
      return 'cloud:Azure'
  }
}

function computeNotesEgress(settings: AppSettings): NotesEgress {
  switch (settings.extractionProvider) {
    case 'anthropic':
      return 'cloud:Anthropic'
    case 'openai-compatible': {
      const name = settings.openaiCompatible.displayName
      return `cloud:custom:${name}`
    }
    case 'azure-openai': {
      const name = settings.azureOpenAI.displayName
      return `cloud:${name}`
    }
  }
}

// ---------------------------------------------------------------------------
// Disclosure copy
// ---------------------------------------------------------------------------

export interface DisclosureCopy {
  /**
   * Short badge text for the persistent EgressIndicator (item 0013).
   * E.g. "audio lokaal · notulen via Anthropic"
   */
  badgeText: string
  /**
   * Human-readable sentence about what happens to audio.
   * Shown at the point-of-choice when a user picks an ASR provider.
   */
  audioDisclosure: string
  /**
   * Human-readable sentence about what happens to transcript text.
   * Shown at the point-of-choice when a user picks an extraction provider.
   */
  notesDisclosure: string
}

/**
 * Build human-readable disclosure copy from an EgressState.
 *
 * Strings are in Dutch (primary language per CONTEXT.md). They are intentionally
 * plain and factual — no marketing language, per engineering principle #12.
 *
 * This function is pure and has no side effects.
 */
export function buildDisclosureCopy(state: EgressState): DisclosureCopy {
  const audioDisclosure = buildAudioDisclosure(state.audio)
  const notesDisclosure = buildNotesDisclosure(state.notes)
  const badgeText = buildBadgeText(state)
  return { audioDisclosure, notesDisclosure, badgeText }
}

function buildAudioDisclosure(audio: AudioEgress): string {
  if (audio === 'local') {
    return 'Audio wordt lokaal verwerkt; er verlaat geen audio het apparaat.'
  }
  // audio = 'cloud:Deepgram'
  const provider = audio.slice('cloud:'.length) // 'Deepgram'
  return `Audio wordt via ${provider} getranscribeerd; de audiostream verlaat het apparaat naar ${provider}.`
}

function buildNotesDisclosure(notes: NotesEgress): string {
  if (notes === 'cloud:Anthropic') {
    return 'Transcripttekst wordt naar Anthropic gestuurd voor extractie van beslissingen en actiepunten.'
  }
  // Extract provider name from 'cloud:custom:<name>' or 'cloud:<name>'
  const withCustomPrefix = 'cloud:custom:'
  if (notes.startsWith(withCustomPrefix)) {
    const name = notes.slice(withCustomPrefix.length)
    return `Transcripttekst wordt naar ${name} gestuurd voor extractie van beslissingen en actiepunten.`
  }
  // Generic case for 'cloud:<name>' (e.g., 'cloud:Azure OpenAI')
  const name = notes.slice('cloud:'.length)
  return `Transcripttekst wordt naar ${name} gestuurd voor extractie van beslissingen en actiepunten.`
}

function buildBadgeText(state: EgressState): string {
  const audioPart = buildAudioBadgePart(state.audio)
  const notesPart = buildNotesBadgePart(state.notes)
  return `${audioPart} · ${notesPart}`
}

function buildAudioBadgePart(audio: AudioEgress): string {
  if (audio === 'local') return 'audio lokaal'
  const provider = audio.slice('cloud:'.length)
  return `audio via ${provider}`
}

function buildNotesBadgePart(notes: NotesEgress): string {
  if (notes === 'cloud:Anthropic') return 'notulen via Anthropic'
  // Extract provider name from 'cloud:custom:<name>' or 'cloud:<name>'
  const withCustomPrefix = 'cloud:custom:'
  if (notes.startsWith(withCustomPrefix)) {
    const name = notes.slice(withCustomPrefix.length)
    return `notulen via ${name}`
  }
  // Generic case for 'cloud:<name>' (e.g., 'cloud:Azure OpenAI')
  const name = notes.slice('cloud:'.length)
  return `notulen via ${name}`
}
