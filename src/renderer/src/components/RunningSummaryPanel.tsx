/**
 * RunningSummaryPanel — item 0020.
 *
 * Renders the live running summary and an "ask the meeting" query box.
 *
 * - Shows the latest running summary text (auto-updated via onSummaryChanged).
 * - Displays a "niet gezaghebbend" disclaimer.
 * - Provides a Dutch query input: Enter or the "Vraag" button submits.
 * - The answer is displayed below the input.
 * - All UI strings are Dutch (i18n).
 *
 * The component reads runningSummary from the Zustand store and calls
 * window.api.summaryQuery for ad-hoc queries. No persistence.
 */

import React, { useCallback, useState } from 'react'

import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// RunningSummaryPanel
// ---------------------------------------------------------------------------

export function RunningSummaryPanel(): React.JSX.Element {
  const runningSummary = useAppStore((s) => s.runningSummary)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleQuery = useCallback(async () => {
    const q = question.trim()
    if (q === '') return
    setLoading(true)
    setAnswer(null)
    try {
      const result = await window.api.summaryQuery({ question: q })
      setAnswer(result.answer)
    } finally {
      setLoading(false)
    }
  }, [question])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleQuery()
      }
    },
    [handleQuery],
  )

  return (
    <section className="running-summary-panel" aria-label={t('live.summary.heading')}>
      <h3 className="running-summary-heading">{t('live.summary.heading')}</h3>
      <p className="running-summary-disclaimer">{t('live.summary.disclaimer')}</p>

      <div className="running-summary-text" data-testid="running-summary-text">
        {runningSummary !== '' ? runningSummary : t('live.summary.empty')}
      </div>

      <div className="running-summary-query">
        <input
          type="text"
          className="running-summary-input"
          placeholder={t('live.summary.query.placeholder')}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          aria-label={t('live.summary.query.placeholder')}
          data-testid="summary-query-input"
        />
        <button
          className="running-summary-ask-button"
          onClick={() => void handleQuery()}
          disabled={loading || question.trim() === ''}
          data-testid="summary-query-button"
        >
          {loading ? t('live.summary.loading') : t('live.summary.query.button')}
        </button>
      </div>

      {answer !== null && (
        <div className="running-summary-answer" data-testid="summary-answer">
          <span className="running-summary-answer-label">{t('live.summary.answer.label')}: </span>
          {answer}
        </div>
      )}
    </section>
  )
}
