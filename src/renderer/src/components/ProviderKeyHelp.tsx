/**
 * ProviderKeyHelp (Phase 5.3).
 *
 * A one-line pointer to where the user gets a vendor's API key/endpoint, shown
 * in that vendor's config panel. Driven by the keyRef so it mirrors
 * SharedKeyNotice: a known vendor keyRef renders its page; a custom/unknown
 * keyRef renders nothing (we have no canonical page to point at).
 *
 * The URL is selectable text, not a live link: the renderer is sandboxed and we
 * deliberately avoid an external-navigation channel here.
 */

import React from 'react'

import { PROVIDER_KEY_HELP } from '../../../shared/providers'
import { t } from '../i18n'

interface ProviderKeyHelpProps {
  /** The vendor keyRef of the panel this help sits in. */
  keyRef: string
  testId: string
}

export function ProviderKeyHelp(props: ProviderKeyHelpProps): React.JSX.Element | null {
  const entry = PROVIDER_KEY_HELP[props.keyRef]
  if (entry === undefined) return null
  return (
    <p data-testid={props.testId} className="settings-key-help">
      <span className="settings-key-help__label">{t('settings.keyHelp.label')}</span>{' '}
      <span className="settings-key-help__url">{entry.keyUrl}</span>
    </p>
  )
}
