/**
 * Live screen — item 0013 placeholder.
 *
 * Full implementation comes in item 0017 (proposed items, keyboard flow, etc.).
 * This placeholder establishes the data-testid and the visual slot.
 */

import React from 'react'

import { t } from '../i18n'

export function LiveScreen(): React.JSX.Element {
  return (
    <main data-testid="screen-live" className="screen screen--live">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.live.title')}</h1>
        <p className="screen__subtitle">{t('screen.live.subtitle')}</p>
      </header>
      <section className="screen__body screen__body--placeholder">
        <p className="placeholder-text">Live notulen komen hier (item 0017).</p>
      </section>
    </main>
  )
}
