/**
 * LiveHeader — the Live screen's title bar + session controls (A1 split).
 *
 * Owns the two things that belong together: the pause/resume + end-meeting
 * buttons and the finalising overlay they raise. Because ending a meeting runs
 * a synchronous multi-second final pass, the overlay and the `endingMeeting`
 * flag live here as one unit rather than being split across the orchestrator.
 *
 * Store-connected for the meeting identity/title/permission and navigation; the
 * `setCapturePaused` callback comes from the useLiveSession hook in the
 * orchestrator (it drives audio capture, not store state), so it is a prop.
 */

import React, { useCallback, useEffect, useState } from 'react'

import { t } from '../i18n'
import { callApi } from '../lib/callApi'
import { useAppStore } from '../store/appStore'

interface LiveHeaderProps {
  /** From useLiveSession: pause/resume the mic+loopback capture. */
  setCapturePaused: (paused: boolean) => void
}

export function LiveHeader({ setCapturePaused }: LiveHeaderProps): React.JSX.Element {
  const activeMeeting = useAppStore((s) => s.activeMeeting)
  const liveMeetingId = useAppStore((s) => s.liveMeetingId)
  const meetingTitle = useAppStore((s) => s.meetingTitle)
  const micPermission = useAppStore((s) => s.micPermission)
  const setLiveMeetingId = useAppStore((s) => s.setLiveMeetingId)
  const setRoute = useAppStore((s) => s.setRoute)

  const [paused, setPaused] = useState(false)
  const [endingMeeting, setEndingMeeting] = useState(false)

  // LiveScreen is mounted permanently (only hidden via CSS), so endingMeeting
  // must not leak from a finished meeting into the next one. Clear it whenever a
  // new or resumed recording session begins — otherwise the finalising overlay
  // from the previous meeting would block the incoming Live screen.
  useEffect(() => {
    if (liveMeetingId !== null) setEndingMeeting(false)
  }, [liveMeetingId])

  const isRecording = micPermission === 'granted'

  const handleTogglePause = useCallback(async () => {
    if (activeMeeting === null) return
    if (paused) {
      const ok = await callApi('LiveHeader resume', () =>
        window.api.meetingResume({ meetingId: activeMeeting }),
      )
      if (ok) {
        setCapturePaused(false)
        setPaused(false)
      }
    } else {
      const ok = await callApi('LiveHeader pause', () =>
        window.api.meetingPause({ meetingId: activeMeeting }),
      )
      if (ok) {
        setCapturePaused(true)
        setPaused(true)
      }
    }
  }, [activeMeeting, paused, setCapturePaused])

  const handleEndMeeting = useCallback(async () => {
    if (activeMeeting === null || endingMeeting) return
    setEndingMeeting(true)
    const ok = await callApi('LiveHeader meetingEnd', () =>
      window.api.meetingEnd({ meetingId: activeMeeting }),
    )
    if (ok) {
      // The recording session is over: clear the live id so useLiveSession tears
      // down audio capture. activeMeeting stays set so Review can read the meeting.
      setLiveMeetingId(null)
      // Navigation to 'review' happens when items:summaries arrives.
      // If the runtime has no provider, items:summaries may not fire — navigate anyway.
      setRoute('review')
    } else {
      setEndingMeeting(false)
    }
  }, [activeMeeting, endingMeeting, setLiveMeetingId, setRoute])

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Finalising overlay — the final pass runs synchronously inside      */}
      {/* meetingEnd (inference + extraction + per-agenda summaries, several  */}
      {/* seconds of provider calls). Make that wait explicit so ending the   */}
      {/* meeting never looks frozen; it clears when we navigate to Review.   */}
      {/* ------------------------------------------------------------------ */}
      {endingMeeting && (
        <div
          className="live-ending-overlay"
          data-testid="live-ending-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="live-ending-overlay__card">
            <span className="live-ending-overlay__spinner" aria-hidden="true" />
            <p className="live-ending-overlay__title">{t('live.ending.title')}</p>
            <p className="live-ending-overlay__subtitle">{t('live.ending.subtitle')}</p>
          </div>
        </div>
      )}

      <header className="live-header">
        <div className="live-header__heading">
          {isRecording && <span className="live-rec-dot" aria-hidden="true" />}
          <h1 className="screen__title live-header__title">
            {meetingTitle.length > 0 ? meetingTitle : t('screen.live.title')}
          </h1>
        </div>
        <div className="live-header__actions">
          <button
            type="button"
            className="btn btn--ghost live-pause-btn"
            data-testid="pause-meeting-btn"
            disabled={endingMeeting}
            onClick={() => {
              void handleTogglePause()
            }}
          >
            {paused ? t('live.resume.button') : t('live.pause.button')}
          </button>
          <button
            type="button"
            className="btn btn--secondary live-end-btn"
            data-testid="end-meeting-btn"
            disabled={endingMeeting}
            aria-busy={endingMeeting}
            onClick={() => {
              void handleEndMeeting()
            }}
          >
            {endingMeeting ? t('live.end.busy') : t('live.end.button')}
          </button>
        </div>
      </header>
    </>
  )
}
