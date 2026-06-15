/**
 * Live screen (items 0015 + 0017 — audio capture + loopback toggle + transcript).
 *
 * Starts audio capture on mount. In 'remote' mode (default) it also requests
 * system loopback via getDisplayMedia and mixes mic + loopback into one PCM
 * stream. If the user denies the picker or loopback is unavailable, it falls
 * back to mic-only with a visible status message.
 *
 * The loopback toggle lets the user switch between:
 *   'remote'   — video meeting (mic + system audio)
 *   'mic-only' — in-person (mic only)
 *
 * The toggle is only available before the session starts. Once started, the
 * mode is locked until the user stops and restarts the session.
 *
 * Full proposed-items UI comes in item 0018.
 */

import React, { useEffect, useRef } from 'react'

import { TranscriptSpanSchema } from '@shared/ipc'

import { t } from '../i18n'
import { AudioCaptureService, PermissionDeniedError } from '../services/AudioCaptureService'
import { useAppStore } from '../store/appStore'

export function LiveScreen(): React.JSX.Element {
  const micPermission = useAppStore((s) => s.micPermission)
  const transcriptSpans = useAppStore((s) => s.transcriptSpans)
  const setMicPermission = useAppStore((s) => s.setMicPermission)
  const addTranscriptSpan = useAppStore((s) => s.addTranscriptSpan)
  const captureMode = useAppStore((s) => s.captureMode)
  const loopbackState = useAppStore((s) => s.loopbackState)
  const setCaptureMode = useAppStore((s) => s.setCaptureMode)
  const setLoopbackState = useAppStore((s) => s.setLoopbackState)

  const serviceRef = useRef<AudioCaptureService | null>(null)

  useEffect(() => {
    const service = new AudioCaptureService()
    serviceRef.current = service

    // Subscribe to transcript spans pushed from main
    const unsub = window.api.onTranscriptSpan((raw) => {
      // Validate at the renderer boundary (principle #8)
      const result = TranscriptSpanSchema.safeParse(raw)
      if (result.success) {
        addTranscriptSpan(result.data)
      }
    })

    // Start capture with the selected mode
    void service
      .start(captureMode)
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
      unsub()
      void service.stop().catch((err: unknown) => {
        console.error('[LiveScreen] Error stopping audio capture:', err)
      })
    }
    // captureMode is intentionally not in the deps: the mode is fixed for the
    // lifetime of one capture session. If the user changes mode, they navigate
    // away and back, which remounts and picks up the new mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTranscriptSpan, setMicPermission, setLoopbackState])

  return (
    <main data-testid="screen-live" className="screen screen--live">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.live.title')}</h1>
        <p className="screen__subtitle">{t('screen.live.subtitle')}</p>
      </header>

      {/* Loopback mode toggle (item 0017) */}
      <section className="screen__body screen__body--loopback-toggle">
        <label htmlFor="capture-mode-select" className="loopback-toggle__label">
          {t('live.loopback.toggle.label')}
        </label>
        <select
          id="capture-mode-select"
          data-testid="capture-mode-select"
          value={captureMode}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'remote' || value === 'mic-only') {
              setCaptureMode(value)
            }
          }}
          disabled={micPermission !== 'unknown'}
          className="loopback-toggle__select"
        >
          <option value="remote">{t('live.loopback.mode.remote')}</option>
          <option value="mic-only">{t('live.loopback.mode.mic-only')}</option>
        </select>

        {/* Loopback status feedback */}
        {loopbackState === 'denied' && (
          <p
            className="loopback-status loopback-status--denied"
            role="status"
            data-testid="loopback-denied-message"
          >
            {t('live.loopback.state.denied')}
          </p>
        )}
        {loopbackState === 'active' && (
          <p
            className="loopback-status loopback-status--active"
            role="status"
            data-testid="loopback-active-message"
          >
            {t('live.loopback.state.active')}
          </p>
        )}
        {loopbackState === 'off' && (
          <p
            className="loopback-status loopback-status--off"
            role="status"
            data-testid="loopback-off-message"
          >
            {t('live.loopback.state.off')}
          </p>
        )}
      </section>

      {/* Mic permission status */}
      <section
        className="screen__body"
        data-testid="mic-status"
        data-mic-permission={micPermission}
      >
        {micPermission === 'denied' && (
          <p className="mic-denied-message" role="alert" data-testid="mic-denied-message">
            {t('live.mic.denied')}
          </p>
        )}
        {micPermission === 'unknown' && (
          <p className="mic-starting-message" data-testid="mic-starting-message">
            {t('live.mic.starting')}
          </p>
        )}
        {micPermission === 'granted' && (
          <p className="mic-active-message" data-testid="mic-active-message">
            {t('live.mic.active')}
          </p>
        )}
      </section>

      {/* Transcript pane */}
      <section className="screen__body screen__body--transcript">
        <h2 className="transcript__heading">{t('live.transcript.heading')}</h2>
        {transcriptSpans.length === 0 ? (
          <p className="transcript__empty" data-testid="transcript-empty">
            {t('live.transcript.empty')}
          </p>
        ) : (
          <ul className="transcript__list" data-testid="transcript-list">
            {transcriptSpans.map((span) => (
              <li
                key={span.id}
                data-testid={`transcript-span-${span.id}`}
                className={`transcript__span${span.isFinal === false ? ' transcript__span--interim' : ''}`}
              >
                <span className="transcript__text">{span.text}</span>
                {span.isFinal === false && (
                  <span className="transcript__interim-label">{t('live.transcript.interim')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
