/**
 * useLiveSession — renderer-side live meeting session orchestration.
 *
 * Extracted from LiveScreen.tsx (architecture task 2). One effect owns the whole
 * renderer-side session: create the AudioCaptureService, subscribe to the five
 * main→renderer push channels (transcript spans, proposed items, nudges, running
 * summary, discussion summaries), start capture, and tear all of it down.
 *
 * Pulling it out of the 1000-line screen gives the orchestration locality and an
 * isolated test surface. The recent "mic never starts" bug hid here because the
 * logic could previously only be tested through the entire screen — its root
 * cause was a missing `activeMeeting` dependency, so that dependency is kept in
 * the array below and must not regress.
 *
 * The hook only owns session orchestration + the audio-level meter value;
 * rendering stays in LiveScreen.
 */

import { useEffect, useRef, useState } from 'react'

import {
  AgendaChangedPayloadSchema,
  ItemsChangedPayloadSchema,
  ItemsSummariesPayloadSchema,
  NudgesChangedPayloadSchema,
  SummaryChangedPayloadSchema,
  TranscriptSpanSchema,
} from '@shared/ipc'

import { onValidated } from '../ipc/onValidated'
import { AudioCaptureService, PermissionDeniedError } from '../services/AudioCaptureService'
import { useAppStore } from '../store/appStore'

export interface UseLiveSessionResult {
  /** Smoothed RMS audio level (0–1) for the live meter. */
  audioLevel: number
}

export function useLiveSession(liveMeetingId: string | null): UseLiveSessionResult {
  // Capture mode is read here but intentionally excluded from the effect deps:
  // the mode is locked once capture begins, so a re-run on mode change would
  // never be desirable (see the eslint-disable note below).
  const captureMode = useAppStore((s) => s.captureMode)

  const setMicPermission = useAppStore((s) => s.setMicPermission)
  const addTranscriptSpan = useAppStore((s) => s.addTranscriptSpan)
  const setLoopbackState = useAppStore((s) => s.setLoopbackState)
  const mergeProposedItems = useAppStore((s) => s.mergeProposedItems)
  const setNudges = useAppStore((s) => s.setNudges)
  const setAgendaItems = useAppStore((s) => s.setAgendaItems)
  const setRunningSummary = useAppStore((s) => s.setRunningSummary)
  const setDiscussionSummaries = useAppStore((s) => s.setDiscussionSummaries)
  const setRoute = useAppStore((s) => s.setRoute)

  const [audioLevel, setAudioLevel] = useState(0)

  const serviceRef = useRef<AudioCaptureService | null>(null)
  const audioLevelRef = useRef(0)

  useEffect(() => {
    // Guard: only capture when a live recording session is in progress. App
    // mounts LiveScreen permanently (always in the DOM, only hidden via CSS) so
    // audio capture survives tab switches. That means this effect first runs at
    // app startup with no live meeting — bail until one starts. `liveMeetingId`
    // IS in the dependency array below precisely so the effect re-fires (and
    // starts capture) the moment a meeting goes live; without it, start() would
    // never be called. Crucially this keys off `liveMeetingId`, NOT the loaded
    // `activeMeeting`, so loading a meeting for Review (import / reopen) never
    // starts the microphone.
    if (liveMeetingId === null) return

    const service = new AudioCaptureService()
    serviceRef.current = service

    // Transcript spans
    const unsubSpan = onValidated(window.api.onTranscriptSpan, TranscriptSpanSchema, (span) => {
      addTranscriptSpan(span)
    })

    // Proposed items
    const unsubItems = onValidated(
      window.api.onItemsChanged,
      ItemsChangedPayloadSchema,
      (payload) => {
        mergeProposedItems({ decisions: payload.decisions, actions: payload.actions })
      },
    )

    // Nudges (item 0019)
    const unsubNudges = onValidated(
      window.api.onNudgesChanged,
      NudgesChangedPayloadSchema,
      (payload) => {
        setNudges(payload.nudges)
      },
    )

    // Live agenda inference (ADR 0029) — replace the agenda with the pushed set.
    const unsubAgenda = onValidated(
      window.api.onAgendaChanged,
      AgendaChangedPayloadSchema,
      (payload) => {
        setAgendaItems(payload.agendaItems)
      },
    )

    // Running summary (item 0020)
    const unsubSummary = onValidated(
      window.api.onSummaryChanged,
      SummaryChangedPayloadSchema,
      (payload) => {
        setRunningSummary(payload.summary)
      },
    )

    // Discussion summaries (item 0021) — save to store and navigate to Review.
    // NOT onValidated: navigation to Review must happen whenever the meeting
    // ends, even if the payload is malformed, so the side-effect is unconditional.
    const unsubSummaries = window.api.onItemsSummaries((raw) => {
      const result = ItemsSummariesPayloadSchema.safeParse(raw)
      if (result.success) {
        setDiscussionSummaries(result.data.summaries)
      }
      setRoute('review')
    })

    // Start audio capture. liveMeetingId is non-null here (guarded above), so the
    // real Meeting id is threaded through to main — spans persist under that row.
    let lastLevelTick = 0
    void service
      .start(liveMeetingId, captureMode, (level) => {
        const now = Date.now()
        if (now - lastLevelTick >= 80) {
          lastLevelTick = now
          audioLevelRef.current = level
          setAudioLevel(level)
        }
      })
      .then((result) => {
        setMicPermission('granted')
        setLoopbackState(result.loopbackState)
      })
      .catch((err: unknown) => {
        if (err instanceof PermissionDeniedError) {
          setMicPermission('denied')
        } else {
          setMicPermission('denied')
          console.error('[LiveScreen] Audio capture error:', err)
        }
      })

    return () => {
      unsubSpan()
      unsubItems()
      unsubNudges()
      unsubAgenda()
      unsubSummary()
      unsubSummaries()
      void service.stop().catch((err: unknown) => {
        console.error('[LiveScreen] Error stopping audio capture:', err)
      })
    }
    // captureMode is intentionally omitted: the mode is locked once capture
    // begins (the selector is disabled while micPermission !== 'unknown'), so a
    // re-run on mode change would never be desirable. liveMeetingId IS included
    // so capture starts when the meeting goes live and stops when it clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    liveMeetingId,
    addTranscriptSpan,
    setMicPermission,
    setLoopbackState,
    mergeProposedItems,
    setNudges,
    setAgendaItems,
    setRunningSummary,
    setDiscussionSummaries,
    setRoute,
  ])

  return { audioLevel }
}
