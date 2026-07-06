/**
 * Draft screen (item 0014) — meeting setup before starting.
 *
 * Allows the user to:
 * - Enter a meeting title
 * - Add/remove agenda items
 * - Add/remove participants
 * - Select primary language (defaults to Dutch)
 * - Click "Start" to transition to Live (disabled until title is present)
 *
 * Keyboard support:
 * - Enter in agenda/participant input adds the item
 * - Start button is keyboard-reachable and activatable
 */

import React, { useState } from 'react'

import type { AgendaItem, Participant } from '@shared/domain/types'

import { SegmentedControl } from '../components/SegmentedControl'
import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A date/time placeholder title for quick-start, e.g. "Vergadering 25 jun 2026
 * 09:00". Dutch month abbreviations, no em-dash (house style). The final pass
 * may replace it with an inferred title (ADR 0029).
 */
function buildAutoTitle(now: Date = new Date()): string {
  const months = [
    'jan',
    'feb',
    'mrt',
    'apr',
    'mei',
    'jun',
    'jul',
    'aug',
    'sep',
    'okt',
    'nov',
    'dec',
  ]
  const mon = months[now.getMonth()] ?? ''
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${t('draft.quickstart.autotitle')} ${String(now.getDate())} ${mon} ${String(now.getFullYear())} ${hh}:${mm}`
}

/**
 * A locally-unique id for a Draft-screen agenda item or participant. These rows
 * do not exist in the DB yet (the meeting is created on Start), so the id is
 * only a React key + local handle; createAndStart replaces it with the real DB
 * id when it persists the prepared set.
 */
function makeDraftId(kind: 'agenda' | 'participant'): string {
  return `draft-${kind}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DraftScreen(): React.JSX.Element {
  const setRoute = useAppStore((s) => s.setRoute)
  const setActiveMeeting = useAppStore((s) => s.setActiveMeeting)
  const setLiveMeetingId = useAppStore((s) => s.setLiveMeetingId)
  const setStoreMeetingTitle = useAppStore((s) => s.setMeetingTitle)
  const setStoreAgendaItems = useAppStore((s) => s.setAgendaItems)
  const setStoreParticipants = useAppStore((s) => s.setParticipants)

  // Meeting state — persisted in the store so it survives navigating away and
  // back (the Draft screen unmounts on tab switch).
  const meetingTitle = useAppStore((s) => s.draftTitle)
  const setMeetingTitle = useAppStore((s) => s.setDraftTitle)
  const primaryLanguage = useAppStore((s) => s.draftPrimaryLanguage)
  const setPrimaryLanguage = useAppStore((s) => s.setDraftPrimaryLanguage)

  // Agenda items
  const agendaItems = useAppStore((s) => s.draftAgendaItems)
  const setAgendaItems = useAppStore((s) => s.setDraftAgendaItems)
  const [agendaInput, setAgendaInput] = useState('')

  // Participants
  const participants = useAppStore((s) => s.draftParticipants)
  const setParticipants = useAppStore((s) => s.setDraftParticipants)
  const [participantInput, setParticipantInput] = useState('')

  // Paste-an-agenda (ADR 0029)
  const pasteText = useAppStore((s) => s.draftPasteText)
  const setPasteText = useAppStore((s) => s.setDraftPasteText)
  const resetDraft = useAppStore((s) => s.resetDraft)
  const [isReading, setIsReading] = useState(false)
  const [showPasteHint, setShowPasteHint] = useState(false)

  // Loading state
  const [isCreating, setIsCreating] = useState(false)

  // ---------------------------------------------------------------------------
  // Validity check
  // ---------------------------------------------------------------------------

  const isValid = meetingTitle.trim().length > 0

  // ---------------------------------------------------------------------------
  // Paste-an-agenda handler (ADR 0029)
  //
  // Structure pasted free text into the editable Draft fields. Pasting is an
  // input method, so the resulting items are Confirmed Draft items (exactly the
  // manual add/remove flow). Degrades gracefully: an empty result (e.g. no
  // extraction key) keeps manual entry working and shows a gentle hint.
  // ---------------------------------------------------------------------------

  const handleReadPaste = async (): Promise<void> => {
    const text = pasteText.trim()
    if (text.length === 0 || isReading) return

    setIsReading(true)
    setShowPasteHint(false)
    try {
      const ctx = await window.api.inferContextFromText({ text, primaryLanguage })
      const titleText = ctx.title?.trim() ?? ''
      const isEmpty =
        titleText.length === 0 && ctx.agendaItems.length === 0 && ctx.participants.length === 0
      if (isEmpty) {
        setShowPasteHint(true)
        return
      }
      if (titleText.length > 0) setMeetingTitle(titleText)
      if (ctx.agendaItems.length > 0) {
        setAgendaItems(
          ctx.agendaItems.map((a, i) => ({
            id: `paste-agenda-${String(Date.now())}-${String(i)}`,
            title: a.title,
            topic: a.topic,
          })),
        )
      }
      if (ctx.participants.length > 0) {
        setParticipants(
          ctx.participants.map((p, i) => ({
            id: `paste-participant-${String(Date.now())}-${String(i)}`,
            name: p.name,
          })),
        )
      }
    } catch (err) {
      console.error('Failed to read pasted agenda:', err)
    } finally {
      setIsReading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Agenda item handlers
  // ---------------------------------------------------------------------------

  // Agenda items and participants are edited locally while the meeting does not
  // yet exist (it is created on Start). Persisting them here is impossible: the
  // agenda_items / participants rows have a NOT NULL foreign key to meetings, so
  // there is no real meetingId to write against. The whole prepared set is
  // persisted in createAndStart against the freshly-created meeting (audit C1).
  const handleAddAgendaItem = (): void => {
    const title = agendaInput.trim()
    if (title.length === 0) return

    setAgendaItems([...agendaItems, { id: makeDraftId('agenda'), title, topic: title }])
    setAgendaInput('')
  }

  const handleRemoveAgendaItem = (itemId: string): void => {
    setAgendaItems(agendaItems.filter((item) => item.id !== itemId))
  }

  const handleAgendaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddAgendaItem()
    }
  }

  // ---------------------------------------------------------------------------
  // Participant handlers
  // ---------------------------------------------------------------------------

  const handleAddParticipant = (): void => {
    const name = participantInput.trim()
    if (name.length === 0) return

    setParticipants([...participants, { id: makeDraftId('participant'), name }])
    setParticipantInput('')
  }

  const handleRemoveParticipant = (participantId: string): void => {
    setParticipants(participants.filter((p) => p.id !== participantId))
  }

  const handleParticipantKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddParticipant()
    }
  }

  // ---------------------------------------------------------------------------
  // Start meeting handler
  // ---------------------------------------------------------------------------

  const createAndStart = async (title: string, titleAutoGenerated: boolean): Promise<void> => {
    if (isCreating) return

    setIsCreating(true)

    try {
      // Create the meeting (Draft)
      const meeting = await window.api.meetingCreate({ title, primaryLanguage, titleAutoGenerated })

      // Persist the prepared agenda + participants against the real meeting id.
      // During draft editing the meeting did not exist yet, so this is the first
      // time these rows can be written (audit C1). Use the persisted rows (real
      // DB ids) as the live store's source of truth so later grooming edits and
      // owner assignment resolve against the same ids main holds.
      const persistedAgenda: AgendaItem[] = []
      for (const a of agendaItems) {
        persistedAgenda.push(
          await window.api.agendaItemAdd({ meetingId: meeting.id, title: a.title, topic: a.topic }),
        )
      }
      const persistedParticipants: Participant[] = []
      for (const p of participants) {
        persistedParticipants.push(
          await window.api.participantAdd({ meetingId: meeting.id, name: p.name }),
        )
      }

      // The Draft -> Live transition is owned by audio:start (LiveSessionController
      // -> MeetingLifecycleService), armed below by setLiveMeetingId. There is no
      // separate meeting:start IPC; it was a fabricating stub and was removed.

      // Update store and navigate. Set both ids: activeMeeting is the focused
      // meeting; liveMeetingId arms audio capture for this recording session.
      setActiveMeeting(meeting.id)
      setLiveMeetingId(meeting.id)
      setStoreMeetingTitle(meeting.title)
      setStoreAgendaItems(persistedAgenda.map((a) => ({ ...a, state: 'confirmed' as const })))
      setStoreParticipants(persistedParticipants)
      // The draft has been consumed into a live meeting; clear it so the next
      // visit to the Draft screen starts fresh.
      resetDraft()
      setRoute('live')
    } catch (err) {
      console.error('Failed to start meeting:', err)
      setIsCreating(false)
    }
  }

  const handleStart = async (): Promise<void> => {
    if (!isValid) return
    await createAndStart(meetingTitle.trim(), false)
  }

  // Quick-start "Direct starten" (ADR 0029): begin immediately with no prep. A
  // typed title is used as-is (Confirmed, not auto-generated); an empty title
  // gets a date/time placeholder the final pass may replace later.
  const handleQuickStart = async (): Promise<void> => {
    const typed = meetingTitle.trim()
    const hasTitle = typed.length > 0
    await createAndStart(hasTitle ? typed : buildAutoTitle(), !hasTitle)
  }

  // Clear everything the user entered and start over.
  const handleReset = (): void => {
    resetDraft()
    setAgendaInput('')
    setParticipantInput('')
    setShowPasteHint(false)
  }

  const hasDraftInput =
    meetingTitle.length > 0 ||
    agendaItems.length > 0 ||
    participants.length > 0 ||
    pasteText.length > 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main data-testid="screen-draft" className="screen screen--draft">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.draft.title')}</h1>
        <p className="screen__subtitle">{t('screen.draft.subtitle')}</p>
      </header>

      <section className="screen__body">
        <form
          className="draft-form"
          onSubmit={(e): void => {
            e.preventDefault()
            void handleStart()
          }}
        >
          {/* Paste an agenda (ADR 0029) */}
          <div className="form-group">
            <h2 className="form-section-title">{t('draft.paste.heading')}</h2>
            <textarea
              className="form-input form-textarea"
              rows={5}
              placeholder={t('draft.paste.placeholder')}
              aria-label={t('draft.paste.heading')}
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.currentTarget.value)
              }}
              disabled={isReading || isCreating}
            />
            <div className="form-row">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={isReading || isCreating || pasteText.trim().length === 0}
                onClick={() => {
                  void handleReadPaste()
                }}
              >
                {isReading ? t('draft.paste.loading') : t('draft.paste.button')}
              </button>
            </div>
            {showPasteHint && <p className="form-hint">{t('draft.paste.hint')}</p>}
          </div>

          {/* Meeting Title */}
          <div className="form-group">
            <label htmlFor="meeting-title" className="form-label">
              {t('draft.meeting.title.label')}
            </label>
            <input
              id="meeting-title"
              type="text"
              className="form-input"
              placeholder={t('draft.meeting.title.placeholder')}
              value={meetingTitle}
              onChange={(e) => {
                setMeetingTitle(e.currentTarget.value)
              }}
              disabled={isCreating}
            />
          </div>

          {/* Agenda Items */}
          <div className="form-group">
            <h2 className="form-section-title">{t('draft.agenda.heading')}</h2>
            <div className="form-list">
              {agendaItems.map((item) => (
                <div key={item.id} className="list-item" data-testid={`agenda-item-${item.id}`}>
                  <span className="list-item__text">{item.title}</span>
                  <button
                    type="button"
                    className="list-item__remove"
                    onClick={() => {
                      handleRemoveAgendaItem(item.id)
                    }}
                    disabled={isCreating}
                    aria-label={`${t('draft.agenda.remove')} ${item.title}`}
                  >
                    {t('draft.agenda.remove')}
                  </button>
                </div>
              ))}
            </div>
            <div className="form-row">
              <input
                type="text"
                className="form-input"
                placeholder={t('draft.agenda.add.placeholder')}
                value={agendaInput}
                onChange={(e) => {
                  setAgendaInput(e.currentTarget.value)
                }}
                onKeyDown={handleAgendaKeyDown}
                disabled={isCreating}
                aria-label={t('draft.agenda.add.placeholder')}
              />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={isCreating || agendaInput.trim().length === 0}
                onClick={() => {
                  handleAddAgendaItem()
                }}
              >
                {t('draft.add')}
              </button>
            </div>
          </div>

          {/* Participants */}
          <div className="form-group">
            <h2 className="form-section-title">{t('draft.participants.heading')}</h2>
            <div className="form-list">
              {participants.map((p) => (
                <div key={p.id} className="list-item" data-testid={`participant-${p.id}`}>
                  <span className="list-item__text">{p.name}</span>
                  <button
                    type="button"
                    className="list-item__remove"
                    onClick={() => {
                      handleRemoveParticipant(p.id)
                    }}
                    disabled={isCreating}
                    aria-label={`${t('draft.participants.remove')} ${p.name}`}
                  >
                    {t('draft.participants.remove')}
                  </button>
                </div>
              ))}
            </div>
            <div className="form-row">
              <input
                type="text"
                className="form-input"
                placeholder={t('draft.participants.add.placeholder')}
                value={participantInput}
                onChange={(e) => {
                  setParticipantInput(e.currentTarget.value)
                }}
                onKeyDown={handleParticipantKeyDown}
                disabled={isCreating}
                aria-label={t('draft.participants.add.placeholder')}
              />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={isCreating || participantInput.trim().length === 0}
                onClick={() => {
                  handleAddParticipant()
                }}
              >
                {t('draft.add')}
              </button>
            </div>
          </div>

          {/* Language Selector */}
          <div className="form-group">
            <span className="form-label">{t('draft.language.label')}</span>
            <SegmentedControl
              name="draft-language"
              testId="draft-language"
              ariaLabel={t('draft.language.label')}
              value={primaryLanguage}
              options={[
                { value: 'nl', label: t('draft.language.nl') },
                { value: 'en', label: t('draft.language.en') },
              ]}
              onChange={setPrimaryLanguage}
            />
          </div>

          {/* Start Buttons */}
          <div className="form-group form-group--actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!isValid || isCreating}
              title={isValid ? '' : t('draft.start.disabled.reason')}
            >
              {isCreating ? 'Starting...' : t('draft.start.button')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={isCreating}
              title={t('draft.quickstart.hint')}
              onClick={() => {
                void handleQuickStart()
              }}
            >
              {t('draft.quickstart.button')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={isCreating || !hasDraftInput}
              onClick={handleReset}
            >
              {t('draft.reset.button')}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
