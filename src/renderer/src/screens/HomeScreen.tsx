/**
 * HomeScreen — item 0023.
 *
 * Displays a "Nieuwe vergadering" button and the list of past meetings.
 * Clicking an ended meeting loads it and navigates to the Review screen.
 * Interrupted meetings (state === 'live') are shown greyed with a label.
 * Draft meetings are hidden.
 *
 * Rules:
 *  - No Node APIs; all data via window.api.
 *  - All IPC responses validated with Zod before entering the store (principle #8).
 */

import React, { useEffect, useState } from 'react'

import type { Meeting } from '@shared/domain/types'

import { HoldToConfirm } from '../components/HoldToConfirm'
import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeScreen(): React.JSX.Element {
  const setRoute = useAppStore((s) => s.setRoute)
  const loadMeeting = useAppStore((s) => s.loadMeeting)
  const setLiveMeetingId = useAppStore((s) => s.setLiveMeetingId)
  const activeMeeting = useAppStore((s) => s.activeMeeting)

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api
      .meetingList({})
      .then(({ meetings: list }) => {
        setMeetings(list.filter((m) => m.state !== 'draft'))
      })
      .catch(() => {
        // Keep empty list on failure; no crash.
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  // A meeting still in state 'live' that isn't the session running in THIS app
  // instance was never ended by the user — it was left paused or the app crashed
  // mid-recording. That is the only case where resume applies (a user-ended
  // meeting is 'ended' and lands in the history list below).
  const interruptedMeetings = meetings.filter((m) => m.state === 'live' && m.id !== activeMeeting)
  const interrupted = interruptedMeetings[0] ?? null
  const activeLiveMeeting =
    meetings.find((m) => m.state === 'live' && m.id === activeMeeting) ?? null
  const endedMeetings = meetings.filter((m) => m.state === 'ended')

  function handleNewMeeting(): void {
    setRoute('draft')
  }

  // Resume an interrupted meeting: restore its context (title, agenda,
  // participants, items) and re-enter Live. Setting liveMeetingId arms audio
  // capture, and main re-attaches a runtime to the still-'live' meeting so the
  // same transcript continues (LiveSessionController._buildRuntime).
  async function handleResume(meeting: Meeting): Promise<void> {
    if (meeting.state !== 'live') return
    await loadMeeting(meeting.id)
    setLiveMeetingId(meeting.id)
    setRoute('live')
  }

  async function handleReopen(meeting: Meeting): Promise<void> {
    if (meeting.state !== 'ended') return
    await loadMeeting(meeting.id)
    setRoute('review')
  }

  async function handleDelete(meetingId: string): Promise<void> {
    try {
      await window.api.meetingDelete({ meetingId })
      setMeetings((prev) => prev.filter((m) => m.id !== meetingId))
    } catch (err) {
      console.error('[HomeScreen] meetingDelete failed:', err)
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  return (
    <section className="screen screen--home" aria-label="Overzicht">
      <header className="screen__header">
        <h1 className="screen__title">{t('nav.home')}</h1>
        <time
          className="screen__subtitle home__date-header"
          dateTime={new Date().toISOString().slice(0, 10)}
          data-testid="home-date-header"
        >
          {new Date().toLocaleDateString('nl-NL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </time>
      </header>

      <div className="home__body">
        <div className="home__actions">
          {activeLiveMeeting !== null && (
            <div className="home__active-callout" data-testid="home-active-callout">
              <span className="home__active-dot" aria-hidden="true" />
              <span className="home__interrupted-label">
                {t('home.active.callout')} · {activeLiveMeeting.title}
              </span>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setRoute('live')
                }}
              >
                {t('home.active.back')}
              </button>
            </div>
          )}
          {interrupted !== null && activeLiveMeeting === null && (
            <div className="home__interrupted-callout" data-testid="home-interrupted-callout">
              <span className="home__interrupted-label">
                {t('home.interrupted.callout')} · {interrupted.title}
              </span>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="home-resume"
                onClick={() => {
                  void handleResume(interrupted)
                }}
              >
                {t('home.interrupted.resume')}
              </button>
            </div>
          )}
          <div className="home__action-buttons">
            <button
              type="button"
              className="btn btn--primary"
              data-testid="home-new-meeting"
              onClick={handleNewMeeting}
            >
              {t('home.new.button')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="home-import"
              onClick={() => {
                setRoute('import')
              }}
            >
              {t('home.import.button')}
            </button>
          </div>
        </div>

        <div className="home__history">
          <h2 className="home__history-heading">{t('home.meetings.heading')}</h2>

          {!loading && endedMeetings.length === 0 && (
            <p className="home__empty" data-testid="home-empty-state">
              {t('home.meetings.empty')}
            </p>
          )}

          {endedMeetings.length > 0 && (
            <ul className="home__meeting-list" role="list">
              {endedMeetings.map((meeting) => (
                <li key={meeting.id} className="home__meeting-item" data-testid="home-meeting-item">
                  <button
                    type="button"
                    className="home__meeting-btn"
                    onClick={() => {
                      void handleReopen(meeting)
                    }}
                  >
                    <span className="home__meeting-title">{meeting.title}</span>
                    <span className="home__meeting-meta">{formatDate(meeting.createdAt)}</span>
                  </button>
                  {/* Destructive: hold-to-confirm, no red. The Myrtle fill is the
                      friction; releasing early cancels. Keyboard: hold Enter. */}
                  <HoldToConfirm
                    className="home__meeting-delete"
                    data-testid="home-delete"
                    label={t('home.delete.action')}
                    holdLabel={t('home.delete.holding')}
                    aria-label={`${t('home.delete.action')} ${meeting.title}`}
                    title={t('home.delete.hint')}
                    onConfirm={() => {
                      void handleDelete(meeting.id)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
