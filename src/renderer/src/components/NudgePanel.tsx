/**
 * NudgePanel — item 0019.
 *
 * Renders the list of visible (not dismissed) nudges as dismissible banners
 * inside the Live screen. Each nudge:
 *   - Shows the Dutch i18n message for its kind.
 *   - Has a dismiss button (mouse) and supports keyboard dismiss (Escape or D
 *     while the nudge is focused).
 *   - Disappears immediately on dismiss (in-memory; nudges regenerate from
 *     state on the next extraction turn).
 *
 * The component is pure UI: it reads nudges + dismissedNudgeIds from the
 * Zustand store and calls dismissNudge. No IPC, no side effects.
 */

import React, { useCallback } from 'react'

import type { Nudge, NudgeId } from '@shared/domain/types'

import { t, type TranslationKey } from '../i18n'

// ---------------------------------------------------------------------------
// Kind → i18n key mapping
// ---------------------------------------------------------------------------

const NUDGE_MESSAGE_KEY: Record<Nudge['kind'], TranslationKey> = {
  'action-no-owner': 'nudge.action-no-owner',
  'conflicting-decisions': 'nudge.conflicting-decisions',
  'empty-agenda-item': 'nudge.empty-agenda-item',
}

// ---------------------------------------------------------------------------
// NudgeCard
// ---------------------------------------------------------------------------

interface NudgeCardProps {
  nudge: Nudge
  onDismiss: (id: NudgeId) => void
}

function NudgeCard({ nudge, onDismiss }: NudgeCardProps): React.JSX.Element {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        onDismiss(nudge.id)
      }
    },
    [nudge.id, onDismiss],
  )

  return (
    <div
      className="nudge-card"
      role="alert"
      aria-live="polite"
      data-testid={`nudge-${nudge.id}`}
      data-kind={nudge.kind}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <p className="nudge-card__message">{t(NUDGE_MESSAGE_KEY[nudge.kind])}</p>
      <button
        type="button"
        className="nudge-card__dismiss"
        data-testid={`dismiss-nudge-${nudge.id}`}
        aria-label={t('nudge.dismiss')}
        title={`${t('nudge.dismiss')} (D / Escape)`}
        onClick={() => {
          onDismiss(nudge.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NudgePanel
// ---------------------------------------------------------------------------

interface NudgePanelProps {
  nudges: Nudge[]
  dismissedNudgeIds: Set<NudgeId>
  onDismiss: (id: NudgeId) => void
}

export function NudgePanel({
  nudges,
  dismissedNudgeIds,
  onDismiss,
}: NudgePanelProps): React.JSX.Element | null {
  const visible = nudges.filter((n) => !dismissedNudgeIds.has(n.id))

  if (visible.length === 0) return null

  return (
    <section className="nudge-panel" aria-label="Meldingen" data-testid="nudge-panel">
      {visible.map((nudge) => (
        <NudgeCard key={nudge.id} nudge={nudge} onDismiss={onDismiss} />
      ))}
    </section>
  )
}
