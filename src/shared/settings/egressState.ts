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
 * Notes egress names one of three zones (ADR 0040):
 *   - `'local'`                    — extraction runs on a loopback endpoint; nothing leaves the device
 *   - `'local-network:<host>'`     — extraction runs on the user's own server on another LAN host
 *                                    (leaves this device, stays on the network)
 *   - `'cloud:<vendor>'`           — sent to a named cloud provider
 * Display names/hosts are embedded so the badge renders without a lookup table.
 */
export type NotesEgress = 'local' | `local-network:${string}` | `cloud:${string}`

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
    case 'local':
      return computeLocalNotesEgress(settings.local.baseUrl)
  }
}

/**
 * Derive the notes egress zone for a local extraction endpoint from its base URL.
 * A loopback host means nothing leaves the device (`'local'`); any other host is
 * the user's own server reached over the network, which does leave this device
 * and is labelled `'local-network:<host>'` so the badge never lies (ADR 0040).
 */
function computeLocalNotesEgress(baseUrl: string): NotesEgress {
  const host = hostnameOf(baseUrl)
  if (host === null) return 'local-network:onbekend'
  return isLoopbackHost(host) ? 'local' : `local-network:${host}`
}

/** Parse the hostname from a URL, or null when it cannot be parsed. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** True for loopback hosts: localhost, 127.0.0.0/8, and IPv6 ::1. */
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost') return true
  if (h === '::1' || h === '[::1]') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
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

/** Honest-expectations caveat appended to both local disclosures (ADR 0040). */
const LOCAL_QUALITY_CAVEAT =
  ' Let op: lokale modellen leveren doorgaans een lagere extractiekwaliteit dan clouddiensten.'

function buildNotesDisclosure(notes: NotesEgress): string {
  if (notes === 'local') {
    return (
      'Transcripttekst blijft op dit apparaat; er wordt niets naar een externe dienst gestuurd.' +
      LOCAL_QUALITY_CAVEAT
    )
  }
  if (notes.startsWith('local-network:')) {
    const host = notes.slice('local-network:'.length)
    return (
      `Transcripttekst wordt naar je eigen server op ${host} gestuurd; die verlaat dit apparaat ` +
      'maar blijft binnen je netwerk.' +
      LOCAL_QUALITY_CAVEAT
    )
  }
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
  if (notes === 'local') return 'notulen lokaal'
  if (notes.startsWith('local-network:')) {
    const host = notes.slice('local-network:'.length)
    return `notulen op eigen server (${host})`
  }
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
