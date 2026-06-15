/**
 * Review screen — item 0013 placeholder.
 *
 * Full implementation comes in item 0020 (final pass, editing, summaries).
 * This placeholder establishes the data-testid and the visual slot.
 */

import React from 'react'

import { t } from '../i18n'

export function ReviewScreen(): React.JSX.Element {
  return (
    <main data-testid="screen-review" className="screen screen--review">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.review.title')}</h1>
        <p className="screen__subtitle">{t('screen.review.subtitle')}</p>
      </header>
      <section className="screen__body screen__body--placeholder">
        <p className="placeholder-text">Notulenoverzicht komt hier (item 0020).</p>
      </section>
    </main>
  )
}
