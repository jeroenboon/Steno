/**
 * Draft screen — item 0013 placeholder.
 *
 * Full implementation comes in item 0014 (agenda, participants, language).
 * This placeholder establishes the data-testid and the visual slot.
 */

import React from 'react'

import { t } from '../i18n'

export function DraftScreen(): React.JSX.Element {
  return (
    <main data-testid="screen-draft" className="screen screen--draft">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.draft.title')}</h1>
        <p className="screen__subtitle">{t('screen.draft.subtitle')}</p>
      </header>
      <section className="screen__body screen__body--placeholder">
        <p className="placeholder-text">Vergaderingsinstellingen komen hier (item 0014).</p>
      </section>
    </main>
  )
}
