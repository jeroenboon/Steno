/**
 * Live screen (item 0015 — audio capture + transcript display).
 *
 * Starts microphone capture on mount, streams PCM frames to main via IPC,
 * and renders incoming transcript spans from the ASR provider.
 *
 * Permission-denied state is shown as a clear inline message.
 * Interim spans (isFinal === false) are rendered with a visual cue until
 * replaced by their final version.
 *
 * Full proposed-items UI comes in item 0017.
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

    // Start capture
    void service
      .start()
      .then(() => {
        setMicPermission('granted')
      })
      .catch((err: unknown) => {
        if (err instanceof PermissionDeniedError) {
          setMicPermission('denied')
        } else {
          // Unexpected error — still mark denied so the UI shows a message
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
  }, [addTranscriptSpan, setMicPermission])

  return (
    <main data-testid="screen-live" className="screen screen--live">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.live.title')}</h1>
        <p className="screen__subtitle">{t('screen.live.subtitle')}</p>
      </header>

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
