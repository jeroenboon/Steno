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

import { SegmentedControl } from '../components/SegmentedControl'
import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Types for local state
// ---------------------------------------------------------------------------

interface AgendaItem {
  id: string
  title: string
  topic: string
}

interface Participant {
  id: string
  name: string
}

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

  // Meeting state
  const [meetingTitle, setMeetingTitle] = useState('')
  const [primaryLanguage, setPrimaryLanguage] = useState('nl')

  // Agenda items
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([])
  const [agendaInput, setAgendaInput] = useState('')

  // Participants
  const [participants, setParticipants] = useState<Participant[]>([])
  const [participantInput, setParticipantInput] = useState('')

  // Paste-an-agenda (ADR 0029)
  const [pasteText, setPasteText] = useState('')
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

  const handleAddAgendaItem = async (): Promise<void> => {
    if (agendaInput.trim().length === 0) return

    try {
      const item = await window.api.agendaItemAdd({
        meetingId: 'temp', // Will be replaced when meeting is created
        title: agendaInput.trim(),
        topic: agendaInput.trim(),
      })

      setAgendaItems([...agendaItems, item])
      setAgendaInput('')
    } catch (err) {
      console.error('Failed to add agenda item:', err)
    }
  }

  const handleRemoveAgendaItem = async (itemId: string): Promise<void> => {
    try {
      await window.api.agendaItemRemove({ agendaItemId: itemId })
      setAgendaItems(agendaItems.filter((item) => item.id !== itemId))
    } catch (err) {
      console.error('Failed to remove agenda item:', err)
    }
  }

  const handleAgendaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleAddAgendaItem()
    }
  }

  // ---------------------------------------------------------------------------
  // Participant handlers
  // ---------------------------------------------------------------------------

  const handleAddParticipant = async (): Promise<void> => {
    if (participantInput.trim().length === 0) return

    try {
      const participant = await window.api.participantAdd({
        meetingId: 'temp', // Will be replaced when meeting is created
        name: participantInput.trim(),
      })

      setParticipants([...participants, participant])
      setParticipantInput('')
    } catch (err) {
      console.error('Failed to add participant:', err)
    }
  }

  const handleRemoveParticipant = async (participantId: string): Promise<void> => {
    try {
      await window.api.participantRemove({ participantId })
      setParticipants(participants.filter((p) => p.id !== participantId))
    } catch (err) {
      console.error('Failed to remove participant:', err)
    }
  }

  const handleParticipantKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleAddParticipant()
    }
  }

  // ---------------------------------------------------------------------------
  // Start meeting handler
  // ---------------------------------------------------------------------------

  const createAndStart = async (title: string, titleAutoGenerated: boolean): Promise<void> => {
    if (isCreating) return

    setIsCreating(true)

    try {
      // Create the meeting
      const meeting = await window.api.meetingCreate({ title, primaryLanguage, titleAutoGenerated })

      // Start the meeting (Draft → Live)
      await window.api.meetingStart({ meetingId: meeting.id })

      // Update store and navigate. Set both ids: activeMeeting is the focused
      // meeting; liveMeetingId arms audio capture for this recording session.
      setActiveMeeting(meeting.id)
      setLiveMeetingId(meeting.id)
      setStoreMeetingTitle(meeting.title)
      setStoreAgendaItems(agendaItems)
      setStoreParticipants(participants)
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
                      void handleRemoveAgendaItem(item.id)
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
                  void handleAddAgendaItem()
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
                      void handleRemoveParticipant(p.id)
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
                  void handleAddParticipant()
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
          </div>
        </form>
      </section>
    </main>
  )
}
