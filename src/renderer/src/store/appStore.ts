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

import type {
  TranscriptSpan,
  AgendaItem,
  Participant,
  Nudge,
  NudgeId,
  DiscussionSummary,
} from '@shared/domain/types'
import type { ItemsChangedPayload } from '@shared/ipc'

import type { CaptureMode, LoopbackState } from '../services/AudioCaptureService'

// Convenience type aliases for the item list entries
export type ProposedDecision = ItemsChangedPayload['decisions'][number]
export type ProposedAction = ItemsChangedPayload['actions'][number]

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
   * Title of the active meeting (item 0022).
   * Stored so the ReviewScreen can include it in exports.
   * Empty string when no meeting is active.
   */
  meetingTitle: string

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

  /**
   * Selected capture mode (item 0017).
   * 'remote' = mic + system loopback mixed (default for video meetings).
   * 'mic-only' = mic only (in-person).
   */
  captureMode: CaptureMode

  /**
   * Actual loopback state after start() resolves (item 0017).
   * null = capture not yet started.
   */
  loopbackState: LoopbackState | null

  /**
   * Proposed decisions from the last extraction turn (item 0018).
   * Keyed by id; replaced wholesale on each items:changed event.
   */
  proposedDecisions: ProposedDecision[]

  /**
   * Proposed actions from the last extraction turn (item 0018).
   */
  proposedActions: ProposedAction[]

  /**
   * Confirmed decisions (user has confirmed; retained after confirmation).
   */
  confirmedDecisions: ProposedDecision[]

  /**
   * Confirmed actions.
   */
  confirmedActions: ProposedAction[]

  /**
   * Agenda items for the current meeting (set from Draft screen data).
   * Used for grouping items in the Live screen.
   */
  agendaItems: AgendaItem[]

  /**
   * Participants for the current meeting.
   * Used for the owner picker in the Live screen.
   */
  participants: Participant[]

  /**
   * Nudges derived from the current meeting state (item 0019).
   * Replaced wholesale on each nudges:changed event from main.
   */
  nudges: Nudge[]

  /**
   * IDs of nudges dismissed by the note-taker (item 0019).
   * In-memory only — nudges regenerate from state on the next turn.
   */
  dismissedNudgeIds: Set<NudgeId>

  /**
   * Current running summary from the extraction provider (item 0020).
   * Updated on every summary:changed IPC event. Empty string when not yet available.
   * In-memory only — not persisted.
   */
  runningSummary: string

  /**
   * Discussion Summaries from the final extraction pass (item 0021).
   * Populated when the meeting ends and items:summaries is received.
   * Each summary covers one Agenda Item's discussion.
   */
  discussionSummaries: DiscussionSummary[]

  /** Replace the full nudge list (called on nudges:changed IPC event). */
  setNudges: (nudges: Nudge[]) => void

  /** Mark a nudge as dismissed (hides it from the UI). */
  dismissNudge: (id: NudgeId) => void

  /** Navigate to a different screen. */
  setRoute: (route: AppRoute) => void

  /** Set (or clear) the active meeting id. */
  setActiveMeeting: (id: string | null) => void

  /** Set the active meeting title (item 0022). */
  setMeetingTitle: (title: string) => void

  /** Update the microphone permission state. */
  setMicPermission: (permission: MicPermission) => void

  /**
   * Append or update a transcript span.
   * If a span with the same id already exists it is replaced (interim update).
   * Otherwise the span is appended to the end of the list.
   */
  addTranscriptSpan: (span: TranscriptSpan) => void

  /** Set the capture mode (before starting a session). */
  setCaptureMode: (mode: CaptureMode) => void

  /** Update the loopback state after start() resolves. */
  setLoopbackState: (state: LoopbackState) => void

  /**
   * Merge newly proposed decisions/actions from an items:changed event (item 0018).
   * Proposed items are replaced with the new set from the turn.
   * Confirmed items already in the store are NOT touched.
   */
  mergeProposedItems: (payload: {
    decisions: ProposedDecision[]
    actions: ProposedAction[]
  }) => void

  /**
   * Move a proposed decision/action to the confirmed list (note-taker confirmed it).
   * Removes from proposed, adds to confirmed with state='confirmed'.
   */
  confirmItem: (kind: 'decision' | 'action', id: string) => void

  /**
   * Remove a proposed decision/action (note-taker dismissed it or agent retracted it).
   */
  removeProposedItem: (kind: 'decision' | 'action', id: string) => void

  /**
   * Add a confirmed item directly (manual add, item 0018).
   */
  addConfirmedItem: (kind: 'decision' | 'action', item: ProposedDecision | ProposedAction) => void

  /** Set the agenda items for the current meeting. */
  setAgendaItems: (items: AgendaItem[]) => void

  /** Set the participants for the current meeting. */
  setParticipants: (participants: Participant[]) => void

  /** Update the running summary (called on summary:changed IPC event). */
  setRunningSummary: (summary: string) => void

  /**
   * Store Discussion Summaries from the final extraction pass (item 0021).
   * Called when items:summaries is received after meeting end.
   * Replaces the previous set wholesale.
   */
  setDiscussionSummaries: (summaries: DiscussionSummary[]) => void
}

// Re-export for convenience
export type { CaptureMode, LoopbackState }

// ---------------------------------------------------------------------------
// Store instance
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()((set) => ({
  route: 'draft',
  activeMeeting: null,
  meetingTitle: '',
  micPermission: 'unknown',
  transcriptSpans: [],
  captureMode: 'remote',
  loopbackState: null,
  proposedDecisions: [],
  proposedActions: [],
  confirmedDecisions: [],
  confirmedActions: [],
  agendaItems: [],
  participants: [],
  nudges: [],
  dismissedNudgeIds: new Set<NudgeId>(),
  runningSummary: '',
  discussionSummaries: [],

  setNudges: (nudges) => {
    set({ nudges })
  },

  dismissNudge: (id) => {
    set((state) => ({
      dismissedNudgeIds: new Set([...state.dismissedNudgeIds, id]),
    }))
  },

  setRoute: (route) => {
    set({ route })
  },
  setActiveMeeting: (id) => {
    set({ activeMeeting: id })
  },
  setMeetingTitle: (title) => {
    set({ meetingTitle: title })
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
  setCaptureMode: (mode) => {
    set({ captureMode: mode })
  },
  setLoopbackState: (state) => {
    set({ loopbackState: state })
  },

  mergeProposedItems: ({ decisions, actions }) => {
    set({ proposedDecisions: decisions, proposedActions: actions })
  },

  confirmItem: (kind, id) => {
    set((state) => {
      if (kind === 'decision') {
        const item = state.proposedDecisions.find((d) => d.id === id)
        if (item === undefined) return {}
        const confirmed = { ...item, state: 'confirmed' as const }
        return {
          proposedDecisions: state.proposedDecisions.filter((d) => d.id !== id),
          confirmedDecisions: [...state.confirmedDecisions.filter((d) => d.id !== id), confirmed],
        }
      } else {
        const item = state.proposedActions.find((a) => a.id === id)
        if (item === undefined) return {}
        const confirmed = { ...item, state: 'confirmed' as const }
        return {
          proposedActions: state.proposedActions.filter((a) => a.id !== id),
          confirmedActions: [...state.confirmedActions.filter((a) => a.id !== id), confirmed],
        }
      }
    })
  },

  removeProposedItem: (kind, id) => {
    set((state) => {
      if (kind === 'decision') {
        return { proposedDecisions: state.proposedDecisions.filter((d) => d.id !== id) }
      } else {
        return { proposedActions: state.proposedActions.filter((a) => a.id !== id) }
      }
    })
  },

  addConfirmedItem: (kind, item) => {
    set((state) => {
      if (kind === 'decision') {
        const d = item as ProposedDecision
        return {
          confirmedDecisions: [
            ...state.confirmedDecisions.filter((x) => x.id !== d.id),
            { ...d, state: 'confirmed' as const },
          ],
        }
      } else {
        const a = item as ProposedAction
        return {
          confirmedActions: [
            ...state.confirmedActions.filter((x) => x.id !== a.id),
            { ...a, state: 'confirmed' as const },
          ],
        }
      }
    })
  },

  setAgendaItems: (items) => {
    set({ agendaItems: items })
  },

  setParticipants: (participants) => {
    set({ participants })
  },

  setRunningSummary: (summary) => {
    set({ runningSummary: summary })
  },

  setDiscussionSummaries: (summaries) => {
    set({ discussionSummaries: summaries })
  },
}))
