/**
 * Live screen — the note-taker's live meeting view (item 0018).
 *
 * After the A1 split this is a thin orchestrator: it owns the session wiring
 * (useLiveSession, keyed on the recording id) and the two-column layout with the
 * MarginLeaders overlay, and composes the panels that do the work:
 *
 *   ┌─ LiveHeader ──────────────────────────────────┐  title + pause/end + overlay
 *   ├─ LiveSessionControls ─────────────────────────┤  loopback + mic + meter
 *   ├─ aside: NudgePanel / LiveItemsPanel / summary ─┤  agenda groups + add bar
 *   └─ TranscriptPane ──────────────────────────────┘  the live canvas
 *
 * Animation is pure CSS (ADR 0037). Each panel is store-connected; the
 * orchestrator only reads the item/transcript counts it needs to key the
 * MarginLeaders recompute (the overlay spans both columns, so it cannot live in
 * a child).
 */

import React from 'react'

import { LiveHeader } from '../components/LiveHeader'
import { LiveItemsPanel } from '../components/LiveItemsPanel'
import { LiveSessionControls } from '../components/LiveSessionControls'
import { MarginLeaders } from '../components/MarginLeaders'
import { NudgePanel } from '../components/NudgePanel'
import { RunningSummaryPanel } from '../components/RunningSummaryPanel'
import { TranscriptPane } from '../components/TranscriptPane'
import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

import { useLiveSession } from './useLiveSession'

export function LiveScreen(): React.JSX.Element {
  // --- Store ---
  const micPermission = useAppStore((s) => s.micPermission)
  const activeMeeting = useAppStore((s) => s.activeMeeting)
  const liveMeetingId = useAppStore((s) => s.liveMeetingId)
  const setRoute = useAppStore((s) => s.setRoute)

  const nudges = useAppStore((s) => s.nudges)
  const dismissedNudgeIds = useAppStore((s) => s.dismissedNudgeIds)
  const dismissNudge = useAppStore((s) => s.dismissNudge)

  // Counts only — used to key the MarginLeaders recompute when the transcript or
  // the item set changes. The panels themselves read the full lists.
  const transcriptSpanCount = useAppStore((s) => s.transcriptSpans.length)
  const proposedDecisionCount = useAppStore((s) => s.proposedDecisions.length)
  const proposedActionCount = useAppStore((s) => s.proposedActions.length)
  const confirmedDecisionCount = useAppStore((s) => s.confirmedDecisions.length)
  const confirmedActionCount = useAppStore((s) => s.confirmedActions.length)
  const transcriptOpen = useAppStore((s) => s.transcriptOpen)

  // --- Session orchestration (audio capture + IPC subscriptions) ---
  // Keyed on liveMeetingId (a recording session), not activeMeeting (which is
  // also set when a meeting is merely loaded for Review).
  const { audioLevel, setCapturePaused } = useLiveSession(liveMeetingId)

  // --- Marginalia leaders ---
  // The live-layout is the positioned container the leader overlay measures
  // within; the recompute key changes whenever spans or items change so the
  // curves are redrawn (resize is handled inside MarginLeaders).
  const liveLayoutRef = React.useRef<HTMLDivElement>(null)
  const leaderRecomputeKey = [
    transcriptSpanCount,
    proposedDecisionCount,
    proposedActionCount,
    confirmedDecisionCount,
    confirmedActionCount,
    transcriptOpen ? 1 : 0,
  ].join(':')

  // --- Render ---
  const isRecording = micPermission === 'granted'

  if (activeMeeting === null) {
    return (
      <main data-testid="screen-live" className="screen screen--live">
        <div className="live-noactive" data-testid="live-noactive">
          <p className="live-noactive__message">{t('live.noactive.message')}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setRoute('draft')
            }}
          >
            {t('live.noactive.action')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      data-testid="screen-live"
      className={`screen screen--live screen--live-items${isRecording ? ' screen--live--recording' : ''}`}
    >
      {/* Header (title + pause/end + finalising overlay) */}
      <LiveHeader setCapturePaused={setCapturePaused} />

      {/* Session controls (loopback toggle + mic status) */}
      <LiveSessionControls audioLevel={audioLevel} />

      <div className="live-layout" ref={liveLayoutRef}>
        <MarginLeaders containerRef={liveLayoutRef} recomputeKey={leaderRecomputeKey} />

        <aside className="live-layout__margin">
          <NudgePanel
            nudges={nudges}
            dismissedNudgeIds={dismissedNudgeIds}
            onDismiss={dismissNudge}
          />

          {/* Decisions / actions surface (agenda groups + manual add). */}
          <LiveItemsPanel />

          {/* Running summary panel (item 0020) */}
          <RunningSummaryPanel />
        </aside>

        {/* Transcript — the live canvas (left column, open by default) */}
        <TranscriptPane />
      </div>
    </main>
  )
}
