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

import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeScreen(): React.JSX.Element {
  const setRoute = useAppStore((s) => s.setRoute)
  const loadMeeting = useAppStore((s) => s.loadMeeting)

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

  function handleNewMeeting(): void {
    setRoute('draft')
  }

  async function handleReopen(meeting: Meeting): Promise<void> {
    if (meeting.state !== 'ended') return
    await loadMeeting(meeting.id)
    setRoute('review')
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
      <div className="home__actions">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="home-new-meeting"
          onClick={handleNewMeeting}
        >
          {t('home.new.button')}
        </button>
      </div>

      <div className="home__history">
        <h2 className="home__history-heading">{t('home.meetings.heading')}</h2>

        {!loading && meetings.length === 0 && (
          <p className="home__empty" data-testid="home-empty-state">
            {t('home.meetings.empty')}
          </p>
        )}

        {meetings.length > 0 && (
          <ul className="home__meeting-list" role="list">
            {meetings.map((meeting) => {
              const isEnded = meeting.state === 'ended'
              const isInterrupted = meeting.state === 'live'
              return (
                <li
                  key={meeting.id}
                  className={`home__meeting-item${isInterrupted ? ' home__meeting-item--interrupted' : ''}`}
                  data-testid="home-meeting-item"
                >
                  <button
                    type="button"
                    className="home__meeting-btn"
                    disabled={!isEnded}
                    aria-disabled={!isEnded}
                    onClick={() => {
                      if (isEnded) {
                        void handleReopen(meeting)
                      }
                    }}
                  >
                    <span className="home__meeting-title">{meeting.title}</span>
                    <span className="home__meeting-meta">
                      {formatDate(meeting.createdAt)}
                      {isInterrupted && (
                        <span className="home__meeting-interrupted-badge">
                          {' '}
                          ({t('home.meeting.interrupted')})
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
