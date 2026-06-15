/**
 * App-level Zustand store (item 0013).
 *
 * Holds the current route and a slot for the active meeting id.
 * Later items (0014+) will enrich this store with meeting state.
 *
 * Keep this store thin: domain data lives in the main process and
 * comes over IPC. This store is UI state only.
 *
 * Item 0015 additions:
 *   - micPermission: tracks getUserMedia permission state
 *   - transcriptSpans: live transcript spans from the ASR provider
 */

import { create } from 'zustand'

import type { TranscriptSpan } from '@shared/domain/types'

// ---------------------------------------------------------------------------
// Route type
// ---------------------------------------------------------------------------

/** The top-level screens of the app. */
export type AppRoute = 'draft' | 'live' | 'review' | 'settings'

// ---------------------------------------------------------------------------
// Mic permission type (item 0015)
// ---------------------------------------------------------------------------

/**
 * State of the microphone permission request.
 *
 * 'unknown'  — getUserMedia has not been called yet (initial state)
 * 'granted'  — the user granted mic access; audio is being captured
 * 'denied'   — the user denied mic access (or a system policy blocked it)
 */
export type MicPermission = 'unknown' | 'granted' | 'denied'

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface AppState {
  /** Currently active screen. */
  route: AppRoute

  /**
   * ID of the meeting in progress, if any.
   * Null when on the Draft screen before a meeting is created.
   */
  activeMeeting: string | null

  /**
   * Microphone permission state (item 0015).
   * Updated when the renderer calls getUserMedia.
   */
  micPermission: MicPermission

  /**
   * Live transcript spans from the ASR provider (item 0015).
   * Spans with isFinal=false are interim; they will be replaced when the
   * final span with the same id arrives.
   */
  transcriptSpans: TranscriptSpan[]

  /** Navigate to a different screen. */
  setRoute: (route: AppRoute) => void

  /** Set (or clear) the active meeting id. */
  setActiveMeeting: (id: string | null) => void

  /** Update the microphone permission state. */
  setMicPermission: (permission: MicPermission) => void

  /**
   * Append or update a transcript span.
   * If a span with the same id already exists it is replaced (interim update).
   * Otherwise the span is appended to the end of the list.
   */
  addTranscriptSpan: (span: TranscriptSpan) => void
}

// ---------------------------------------------------------------------------
// Store instance
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()((set) => ({
  route: 'draft',
  activeMeeting: null,
  micPermission: 'unknown',
  transcriptSpans: [],

  setRoute: (route) => {
    set({ route })
  },
  setActiveMeeting: (id) => {
    set({ activeMeeting: id })
  },
  setMicPermission: (permission) => {
    set({ micPermission: permission })
  },
  addTranscriptSpan: (span) => {
    set((state) => {
      const idx = state.transcriptSpans.findIndex((s) => s.id === span.id)
      if (idx !== -1) {
        // Replace existing span (interim → final update)
        const next = [...state.transcriptSpans]
        next[idx] = span
        return { transcriptSpans: next }
      }
      return { transcriptSpans: [...state.transcriptSpans, span] }
    })
  },
}))
