/**
 * TranscriptPane — the Live screen's transcript canvas (A1 split).
 *
 * The collapsible transcript column: a toggle plus the span list, open by
 * default (it is the live canvas). Store-connected — reads the transcript spans
 * straight from the Zustand store (idiom = RunningSummaryPanel) and owns its own
 * open/closed UI state. Interim spans render dimmed; low-confidence finals get a
 * soft flag (a hint, not a hard reject).
 *
 * The open/close accordion is pure CSS (ADR 0037).
 */

import React from 'react'

import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

// Low-confidence threshold (soft flag, not a hard reject).
const LOW_CONFIDENCE_THRESHOLD = 0.6

export function TranscriptPane(): React.JSX.Element {
  const transcriptSpans = useAppStore((s) => s.transcriptSpans)
  const transcriptOpen = useAppStore((s) => s.transcriptOpen)
  const setTranscriptOpen = useAppStore((s) => s.setTranscriptOpen)

  return (
    <section className="live-layout__transcript live-transcript-section screen__body">
      <button
        type="button"
        className="live-transcript__toggle"
        data-testid="transcript-toggle"
        aria-expanded={transcriptOpen}
        onClick={() => {
          setTranscriptOpen(!transcriptOpen)
        }}
      >
        <span className="live-transcript__toggle-icon">{transcriptOpen ? '▾' : '▸'}</span>
        {transcriptOpen ? t('live.transcript.toggle.hide') : t('live.transcript.toggle.show')}
      </button>

      {transcriptOpen && (
        <div className="live-transcript__pane">
          <h2 className="transcript__heading">{t('live.transcript.heading')}</h2>
          {transcriptSpans.length === 0 ? (
            <p className="transcript__empty" data-testid="transcript-empty">
              {t('live.transcript.empty')}
            </p>
          ) : (
            <ul className="transcript__list" data-testid="transcript-list">
              {transcriptSpans.map((span) => {
                const isLowConfidence =
                  span.confidence !== undefined && span.confidence < LOW_CONFIDENCE_THRESHOLD
                return (
                  <li
                    key={span.id}
                    data-testid={`transcript-span-${span.id}`}
                    data-span-id={span.id}
                    data-low-confidence={isLowConfidence ? 'true' : undefined}
                    className={[
                      'transcript__span',
                      span.isFinal === false ? 'transcript__span--interim' : '',
                      isLowConfidence ? 'transcript__span--low-confidence' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="transcript__text">{span.text}</span>
                    {span.isFinal === false && (
                      <span className="transcript__interim-label">
                        {t('live.transcript.interim')}
                      </span>
                    )}
                    {isLowConfidence && (
                      <span
                        className="transcript__low-confidence-flag"
                        title={t('live.items.low-confidence')}
                      >
                        ~
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
