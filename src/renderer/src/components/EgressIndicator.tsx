/**
 * EgressIndicator — item 0013.
 *
 * A persistent badge in the app chrome that shows the current egress state
 * in plain Dutch. Required on every screen per ADR 0003.
 *
 * The component is intentionally passive: it receives the EgressState as a
 * prop. The parent (App) owns the IPC subscription and passes down the value.
 *
 * Badge text is derived from buildDisclosureCopy() in @shared/settings/egressState,
 * keeping the logic in one place and the renderer UI-only.
 */

import React from 'react'

import type { EgressState } from '@shared/ipc'
import type { AsrTerminalReason } from '@shared/providers'
import { buildDisclosureCopy } from '@shared/settings/egressState'

import { t, type TranslationKey } from '../i18n'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EgressIndicatorProps {
  egressState: EgressState
  /**
   * When set, live transcription has stopped permanently (audit C4) and the
   * indicator additively shows why. Null/undefined = normal state, no message.
   */
  terminalReason?: AsrTerminalReason | null
}

/** Dutch message per terminal reason. Externalised via i18n (keyboard/SR read). */
const TERMINAL_MESSAGE_KEY: Record<AsrTerminalReason, TranslationKey> = {
  auth: 'egress.asr.stopped.auth',
  'max-retries': 'egress.asr.stopped.max-retries',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EgressIndicator({
  egressState,
  terminalReason,
}: EgressIndicatorProps): React.JSX.Element {
  const { badgeText } = buildDisclosureCopy(egressState)

  const isCloudAudio = egressState.audio !== 'local'

  return (
    <div
      data-testid="egress-indicator"
      className="egress-indicator"
      title="Welke gegevens het apparaat verlaten"
      aria-label={`Gegevensverwerking: ${badgeText}`}
    >
      {isCloudAudio && <span className="egress-indicator__dot" aria-hidden="true" />}
      <span className="egress-indicator__text">{badgeText}</span>
      {/*
       * Terminal ASR state (audit C4): shown additively next to the normal badge.
       * It's a time-sensitive change the note-taker must notice, so it's an
       * assertive live region — a screen-reader user is told the moment it appears.
       */}
      {terminalReason != null && (
        <span
          data-testid="egress-terminal"
          className="egress-indicator__terminal"
          role="status"
          aria-live="assertive"
        >
          {t(TERMINAL_MESSAGE_KEY[terminalReason])}
        </span>
      )}
    </div>
  )
}
