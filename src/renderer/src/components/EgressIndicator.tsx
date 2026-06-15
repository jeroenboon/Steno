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
import { buildDisclosureCopy } from '@shared/settings/egressState'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EgressIndicatorProps {
  egressState: EgressState
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EgressIndicator({ egressState }: EgressIndicatorProps): React.JSX.Element {
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
    </div>
  )
}
