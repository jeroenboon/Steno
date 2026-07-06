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
  RecordingSource,
} from '@shared/domain/types'
import type { ItemsChangedPayload, MeetingLoadResponse } from '@shared/ipc'
import { MeetingLoadResponseSchema } from '@shared/ipc'
import type { AsrTerminalReason } from '@shared/providers'

import type { CaptureMode, LoopbackState } from '../services/AudioCaptureService'

// Convenience type aliases for the item list entries
export type ProposedDecision = ItemsChangedPayload['decisions'][number]
export type ProposedAction = ItemsChangedPayload['actions'][number]

/**
 * Split a meeting's decisions/actions into the store's four state-keyed lists.
 * The single wholesale-reconcile rule shared by an authoritative items:changed
 * event and the initial meeting load — the Proposed/Confirmed split lives here,
 * not in per-transition store actions (ADR 0033).
 */
function splitItemsByState(
  decisions: ProposedDecision[],
  actions: ProposedAction[],
): {
  proposedDecisions: ProposedDecision[]
  proposedActions: ProposedAction[]
  confirmedDecisions: ProposedDecision[]
  confirmedActions: ProposedAction[]
} {
  return {
    proposedDecisions: decisions.filter((d) => d.state === 'proposed'),
    proposedActions: actions.filter((a) => a.state === 'proposed'),
    confirmedDecisions: decisions.filter((d) => d.state === 'confirmed'),
    confirmedActions: actions.filter((a) => a.state === 'confirmed'),
  }
}

// ---------------------------------------------------------------------------
// Route type
// ---------------------------------------------------------------------------

/** The top-level screens of the app. */
export type AppRoute = 'home' | 'draft' | 'live' | 'review' | 'settings' | 'import'

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
   * ID of the meeting currently in focus — the live meeting during a session, or
   * the meeting loaded for Review. Drives screens that need "the current meeting"
   * (LiveScreen actions, ReviewScreen export). NOT a signal that audio is being
   * captured — see `liveMeetingId` for that.
   */
  activeMeeting: string | null

  /**
   * ID of the meeting whose audio is actively being captured (a live recording
   * session). Set only by the Draft → Live transition and cleared when the
   * meeting ends. This — not `activeMeeting` — is what arms audio capture and the
   * nav "live" affordances. Loading a past or imported meeting for Review sets
   * `activeMeeting` but leaves this null, so review never starts the microphone.
   */
  liveMeetingId: string | null

  /**
   * Title of the active meeting (item 0022).
   * Stored so the ReviewScreen can include it in exports.
   * Empty string when no meeting is active.
   */
  meetingTitle: string

  /**
   * ISO 8601 creation timestamp of the loaded/active meeting, for the Review
   * header. Null when no meeting is loaded.
   */
  meetingCreatedAt: string | null

  /**
   * Where the loaded/active meeting's transcript came from (item 0026).
   * 'import' surfaces a badge in Review; defaults to 'live'.
   */
  meetingSource: RecordingSource

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
   * Whether the Live transcript pane is expanded (A1). Lifted to the store so
   * TranscriptPane owns the toggle while the LiveScreen orchestrator can still
   * fold it into the MarginLeaders recompute key (collapsing the pane shifts
   * the leader anchors). Open by default — it is the live canvas.
   */
  transcriptOpen: boolean

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

  /**
   * Reason live transcription stopped permanently, or null when healthy (audit
   * C4). Set from the asr:terminal push event; main also pushes reason=null when
   * a new session starts, which clears it. Rendered on the EgressIndicator.
   */
  asrTerminalReason: AsrTerminalReason | null

  /** Set (or clear with null) the ASR terminal reason (asr:terminal event). */
  setAsrTerminalReason: (reason: AsrTerminalReason | null) => void

  /** Replace the full nudge list (called on nudges:changed IPC event). */
  setNudges: (nudges: Nudge[]) => void

  /** Mark a nudge as dismissed (hides it from the UI). */
  dismissNudge: (id: NudgeId) => void

  /** Navigate to a different screen. */
  setRoute: (route: AppRoute) => void

  /** Set (or clear) the active meeting id (focus, not capture). */
  setActiveMeeting: (id: string | null) => void

  /** Set (or clear) the live recording session id (arms/disarms audio capture). */
  setLiveMeetingId: (id: string | null) => void

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
  setTranscriptOpen: (open: boolean) => void

  /**
   * Reconcile the full item set for a meeting from an authoritative
   * items:changed event (ADR 0033). Main emits every current decision/action
   * (both states) after any mutation — agent turn or note-taker action — so the
   * renderer replaces its four lists wholesale, split by state. Applied only
   * when the payload's meetingId matches the currently-focused meeting; a stale
   * event for a different meeting is ignored. This replaces the former
   * optimistic transitions (mergeProposedItems / confirmItem / removeProposedItem
   * / addConfirmedItem): the transition rule now lives only in main.
   */
  reconcileItems: (payload: ItemsChangedPayload) => void

  /** Set the agenda items for the current meeting. */
  setAgendaItems: (items: AgendaItem[]) => void

  // --- Draft form state (persists across navigation; cleared on reset/start) ---
  /** Working title typed in the Draft screen. */
  draftTitle: string
  /** Primary language selected in the Draft screen. */
  draftPrimaryLanguage: string
  /** Agenda items added in the Draft screen. */
  draftAgendaItems: { id: string; title: string; topic: string }[]
  /** Participants added in the Draft screen. */
  draftParticipants: { id: string; name: string }[]
  /** Pasted agenda text in the Draft screen. */
  draftPasteText: string
  setDraftTitle: (title: string) => void
  setDraftPrimaryLanguage: (language: string) => void
  setDraftAgendaItems: (items: { id: string; title: string; topic: string }[]) => void
  setDraftParticipants: (participants: { id: string; name: string }[]) => void
  setDraftPasteText: (text: string) => void
  /** Clear all Draft form fields ("opnieuw beginnen"). */
  resetDraft: () => void

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

  /**
   * Load a past meeting's full state from main via IPC and populate the store
   * so the Review screen can render it (item 0023).
   * Validates the IPC response with Zod before entering the store (principle #8).
   */
  loadMeeting: (id: string) => Promise<void>
}

// Re-export for convenience
export type { CaptureMode, LoopbackState }

// ---------------------------------------------------------------------------
// Store instance
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()((set) => ({
  route: 'home',
  activeMeeting: null,
  liveMeetingId: null,
  meetingTitle: '',
  meetingCreatedAt: null,
  meetingSource: 'live',
  micPermission: 'unknown',
  transcriptSpans: [],
  captureMode: 'remote',
  loopbackState: null,
  transcriptOpen: true,
  proposedDecisions: [],
  proposedActions: [],
  confirmedDecisions: [],
  confirmedActions: [],
  agendaItems: [],
  participants: [],
  draftTitle: '',
  draftPrimaryLanguage: 'nl',
  draftAgendaItems: [],
  draftParticipants: [],
  draftPasteText: '',
  nudges: [],
  dismissedNudgeIds: new Set<NudgeId>(),
  runningSummary: '',
  discussionSummaries: [],
  asrTerminalReason: null,

  setAsrTerminalReason: (reason) => {
    set({ asrTerminalReason: reason })
  },

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
  setLiveMeetingId: (id) => {
    set({ liveMeetingId: id })
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
  setTranscriptOpen: (open) => {
    set({ transcriptOpen: open })
  },

  reconcileItems: (payload) => {
    set((state) => {
      // Ignore a stale event for a meeting other than the one in focus.
      if (payload.meetingId !== state.activeMeeting) return {}
      return splitItemsByState(payload.decisions, payload.actions)
    })
  },

  setAgendaItems: (items) => {
    set({ agendaItems: items })
  },

  setParticipants: (participants) => {
    set({ participants })
  },

  setDraftTitle: (draftTitle) => {
    set({ draftTitle })
  },
  setDraftPrimaryLanguage: (draftPrimaryLanguage) => {
    set({ draftPrimaryLanguage })
  },
  setDraftAgendaItems: (draftAgendaItems) => {
    set({ draftAgendaItems })
  },
  setDraftParticipants: (draftParticipants) => {
    set({ draftParticipants })
  },
  setDraftPasteText: (draftPasteText) => {
    set({ draftPasteText })
  },
  resetDraft: () => {
    set({
      draftTitle: '',
      draftPrimaryLanguage: 'nl',
      draftAgendaItems: [],
      draftParticipants: [],
      draftPasteText: '',
    })
  },

  setRunningSummary: (summary) => {
    set({ runningSummary: summary })
  },

  setDiscussionSummaries: (summaries) => {
    set({ discussionSummaries: summaries })
  },

  loadMeeting: async (id: string) => {
    const raw = await window.api.meetingLoad({ meetingId: id })
    const payload: MeetingLoadResponse = MeetingLoadResponseSchema.parse(raw)
    set({
      activeMeeting: id,
      meetingTitle: payload.meeting.title,
      meetingCreatedAt: payload.meeting.createdAt,
      meetingSource: payload.meeting.source,
      // Review must surface Proposed items too: the final pass and any un-confirmed
      // live proposals are Proposed, and the note-taker confirms/dismisses them
      // here. Same wholesale split by state as an authoritative items:changed.
      ...splitItemsByState(payload.decisions, payload.actions),
      agendaItems: payload.agendaItems,
      participants: payload.participants,
      discussionSummaries: payload.summaries,
    })
  },
}))
