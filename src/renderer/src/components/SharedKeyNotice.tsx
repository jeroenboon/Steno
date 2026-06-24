/**
 * SharedKeyNotice (Phase 5.2).
 *
 * One vendor key (openai/mistral/azure) can back both the ASR and extraction
 * roles. When the panel's keyRef is the shared one, this renders a short note so
 * the user understands that entering or replacing the key here applies to both
 * roles — and doesn't expect to manage two separate keys.
 */

import React from 'react'

import { getSharedKeyRef } from '../../../shared/settings/keyRefs'
import type { AppSettings } from '../../../shared/settings/settingsSchema'
import { t } from '../i18n'

interface SharedKeyNoticeProps {
  settings: AppSettings
  /** The keyRef of the panel this notice sits in. */
  keyRef: string
  testId: string
}

export function SharedKeyNotice(props: SharedKeyNoticeProps): React.JSX.Element | null {
  if (getSharedKeyRef(props.settings) !== props.keyRef) return null
  return (
    <p data-testid={props.testId} className="settings-shared-key-notice" role="note">
      {t('settings.sharedKey.notice')}
    </p>
  )
}
