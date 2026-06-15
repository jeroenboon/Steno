/**
 * App-level Zustand store (item 0013).
 *
 * Holds the current route and a slot for the active meeting id.
 * Later items (0014+) will enrich this store with meeting state.
 *
 * Keep this store thin: domain data lives in the main process and
 * comes over IPC. This store is UI state only.
 */

import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Route type
// ---------------------------------------------------------------------------

/** The three top-level screens of the app. */
export type AppRoute = 'draft' | 'live' | 'review'

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

  /** Navigate to a different screen. */
  setRoute: (route: AppRoute) => void

  /** Set (or clear) the active meeting id. */
  setActiveMeeting: (id: string | null) => void
}

// ---------------------------------------------------------------------------
// Store instance
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()((set) => ({
  route: 'draft',
  activeMeeting: null,

  setRoute: (route) => {
    set({ route })
  },
  setActiveMeeting: (id) => {
    set({ activeMeeting: id })
  },
}))
