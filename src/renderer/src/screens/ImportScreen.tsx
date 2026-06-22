/**
 * Import screen (item 0026).
 *
 * Lets the user pick a recorded audio file, give it a title and language, and
 * either type the agenda + participants or have them inferred from the audio.
 * Starting the import decodes + streams the file to main (AudioFileImportService),
 * shows coarse progress, and on success opens the finished meeting in Review.
 *
 * Agenda items and participants are kept as local arrays and sent inside the
 * import:start request, so this screen needs no per-item IPC (unlike Draft).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'

import type { ImportStartRequest } from '@shared/ipc'

import { SegmentedControl } from '../components/SegmentedControl'
import { t } from '../i18n'
import { AudioFileImportService } from '../services/AudioFileImportService'
import { useAppStore } from '../store/appStore'

type Stage = 'idle' | 'running' | 'error'
type AgendaSource = 'upload' | 'infer'

export function ImportScreen(): React.JSX.Element {
  const setRoute = useAppStore((s) => s.setRoute)
  const loadMeeting = useAppStore((s) => s.loadMeeting)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [primaryLanguage, setPrimaryLanguage] = useState('nl')
  const [agendaSource, setAgendaSource] = useState<AgendaSource>('upload')

  const [agendaItems, setAgendaItems] = useState<{ title: string; topic: string }[]>([])
  const [agendaInput, setAgendaInput] = useState('')
  const [participants, setParticipants] = useState<{ name: string }[]>([])
  const [participantInput, setParticipantInput] = useState('')

  const [stage, setStage] = useState<Stage>('idle')
  const [stageLabel, setStageLabel] = useState('')
  const [progress, setProgress] = useState(0)

  const errorRef = useRef(false)
  const service = useMemo(() => new AudioFileImportService(), [])

  // Reflect coarse main-side stage transitions in the UI.
  useEffect(() => {
    const unsub = window.api.onImportProgress((evt) => {
      if (evt.stage === 'error') {
        errorRef.current = true
        setStage('error')
      } else if (evt.stage !== 'done') {
        setStageLabel(t(`import.progress.${evt.stage}`))
      }
    })
    return unsub
  }, [])

  const isValid = file !== null && title.trim().length > 0
  const infer = agendaSource === 'infer'

  const addAgenda = (): void => {
    const value = agendaInput.trim()
    if (value.length === 0) return
    setAgendaItems([...agendaItems, { title: value, topic: value }])
    setAgendaInput('')
  }

  const addParticipant = (): void => {
    const value = participantInput.trim()
    if (value.length === 0) return
    setParticipants([...participants, { name: value }])
    setParticipantInput('')
  }

  const handleStart = async (): Promise<void> => {
    if (file === null || title.trim().length === 0 || stage === 'running') return

    errorRef.current = false
    setStage('running')
    setProgress(0)
    setStageLabel(t('import.progress.transcribing'))

    const req: ImportStartRequest = {
      title: title.trim(),
      primaryLanguage,
      agendaItems: infer ? [] : agendaItems,
      participants: infer ? [] : participants,
      inferContext: infer,
    }

    try {
      const meetingId = await service.streamFile(file, req, { onProgress: setProgress })
      // errorRef may be flipped by an async onImportProgress 'error' event during
      // the await above; eslint's static analysis can't see that mutation.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (errorRef.current) return
      await loadMeeting(meetingId)
      setRoute('review')
    } catch {
      errorRef.current = true
      setStage('error')
    }
  }

  return (
    <main data-testid="screen-import" className="screen screen--import">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.import.title')}</h1>
        <p className="screen__subtitle">{t('screen.import.subtitle')}</p>
      </header>

      <section className="screen__body">
        <form
          className="draft-form"
          onSubmit={(e) => {
            e.preventDefault()
            void handleStart()
          }}
        >
          {/* File picker */}
          <div className="form-group">
            <label htmlFor="import-file" className="form-label">
              {t('import.file.label')}
            </label>
            <input
              id="import-file"
              data-testid="import-file"
              type="file"
              accept="audio/*"
              className="form-input"
              disabled={stage === 'running'}
              onChange={(e) => {
                setFile(e.currentTarget.files?.[0] ?? null)
              }}
            />
            <span className="form-hint">{t('import.file.hint')}</span>
          </div>

          {/* Title */}
          <div className="form-group">
            <label htmlFor="import-title" className="form-label">
              {t('import.title.label')}
            </label>
            <input
              id="import-title"
              type="text"
              className="form-input"
              placeholder={t('import.title.placeholder')}
              value={title}
              disabled={stage === 'running'}
              onChange={(e) => {
                setTitle(e.currentTarget.value)
              }}
            />
          </div>

          {/* Language */}
          <div className="form-group">
            <span className="form-label">{t('import.language.label')}</span>
            <SegmentedControl
              name="import-language"
              testId="import-language"
              ariaLabel={t('import.language.label')}
              value={primaryLanguage}
              options={[
                { value: 'nl', label: t('draft.language.nl') },
                { value: 'en', label: t('draft.language.en') },
              ]}
              onChange={setPrimaryLanguage}
            />
          </div>

          {/* Agenda source: upload vs infer */}
          <div className="form-group">
            <span className="form-label">{t('import.agenda.source.label')}</span>
            <SegmentedControl
              name="import-agenda-source"
              testId="import-agenda-source"
              ariaLabel={t('import.agenda.source.label')}
              value={agendaSource}
              options={[
                { value: 'upload', label: t('import.agenda.source.upload') },
                { value: 'infer', label: t('import.agenda.source.infer') },
              ]}
              onChange={(v) => {
                setAgendaSource(v as AgendaSource)
              }}
            />
          </div>

          {/* Agenda + participants (only when the user supplies them) */}
          {!infer && (
            <>
              <div className="form-group">
                <h2 className="form-section-title">{t('import.agenda.heading')}</h2>
                <div className="form-list">
                  {agendaItems.map((item, i) => (
                    <div key={`${item.title}-${String(i)}`} className="list-item">
                      <span className="list-item__text">{item.title}</span>
                      <button
                        type="button"
                        className="list-item__remove"
                        onClick={() => {
                          setAgendaItems(agendaItems.filter((_, idx) => idx !== i))
                        }}
                      >
                        {t('import.remove')}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="form-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t('import.agenda.add.placeholder')}
                    aria-label={t('import.agenda.add.placeholder')}
                    value={agendaInput}
                    onChange={(e) => {
                      setAgendaInput(e.currentTarget.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addAgenda()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={agendaInput.trim().length === 0}
                    onClick={addAgenda}
                  >
                    {t('import.add')}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <h2 className="form-section-title">{t('import.participants.heading')}</h2>
                <div className="form-list">
                  {participants.map((p, i) => (
                    <div key={`${p.name}-${String(i)}`} className="list-item">
                      <span className="list-item__text">{p.name}</span>
                      <button
                        type="button"
                        className="list-item__remove"
                        onClick={() => {
                          setParticipants(participants.filter((_, idx) => idx !== i))
                        }}
                      >
                        {t('import.remove')}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="form-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t('import.participants.add.placeholder')}
                    aria-label={t('import.participants.add.placeholder')}
                    value={participantInput}
                    onChange={(e) => {
                      setParticipantInput(e.currentTarget.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addParticipant()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={participantInput.trim().length === 0}
                    onClick={addParticipant}
                  >
                    {t('import.add')}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Progress while running */}
          {stage === 'running' && (
            <div className="import-progress" data-testid="import-progress" role="status">
              <span className="import-progress__label">{stageLabel}</span>
              <progress className="import-progress__bar" max={1} value={progress} />
            </div>
          )}

          {/* Error */}
          {stage === 'error' && (
            <div className="import-error" data-testid="import-error" role="alert">
              {t('import.error')}
            </div>
          )}

          {/* Start */}
          <div className="form-group form-group--actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!isValid || stage === 'running'}
              title={isValid ? '' : t('import.start.disabled.reason')}
            >
              {t('import.start.button')}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
