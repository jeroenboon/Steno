/**
 * HoldToConfirm — the destructive-action friction pattern (Cahier Final Master
 * Spec). The user presses and holds for `holdMs` (default 1.5s) before the
 * action fires; releasing early cancels. There is a keyboard path: focus the
 * button and hold Enter or Space.
 *
 * Why hold-to-confirm and not a red button: red is sacred to the live/recording
 * signal (see docs/design/cahier-design-brief.md), so destructive actions lean
 * on deliberate friction, not colour. The progress fill is Myrtle, animated in
 * app.css over `--hold-ms`, so the visual duration always matches the timer.
 *
 * Rules: renderer is UI only; no Node APIs. Timing is a plain setTimeout — the
 * single source of truth is the timer, the CSS fill is purely decorative.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_HOLD_MS = 1500

interface HoldToConfirmProps {
  /** Fired once the hold completes. */
  onConfirm: () => void
  /** Resting label. */
  label: string
  /** Optional label shown while holding (e.g. "Blijf vasthouden…"). */
  holdLabel?: string
  /** Hold duration in milliseconds. */
  holdMs?: number
  className?: string
  disabled?: boolean
  'data-testid'?: string
  'aria-label'?: string
  title?: string
}

export function HoldToConfirm({
  onConfirm,
  label,
  holdLabel,
  holdMs = DEFAULT_HOLD_MS,
  className,
  disabled = false,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
  title,
}: HoldToConfirmProps): React.JSX.Element {
  const [holding, setHolding] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setHolding(false)
  }, [])

  const start = useCallback(() => {
    if (disabled || timerRef.current !== null) return
    setHolding(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setHolding(false)
      onConfirm()
    }, holdMs)
  }, [disabled, holdMs, onConfirm])

  // Clean up a pending timer if the button unmounts mid-hold.
  useEffect(() => cancel, [cancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      // Ignore auto-repeat so the hold starts once and runs for the full duration.
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault()
        start()
      }
    },
    [start],
  )

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        cancel()
      }
    },
    [cancel],
  )

  return (
    <button
      type="button"
      className={`hold-to-confirm${holding ? ' hold-to-confirm--holding' : ''}${
        className !== undefined ? ` ${className}` : ''
      }`}
      style={{ '--hold-ms': `${String(holdMs)}ms` } as React.CSSProperties}
      disabled={disabled}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      title={title}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <span className="hold-to-confirm__fill" aria-hidden="true" />
      <span className="hold-to-confirm__label">
        {holding && holdLabel !== undefined ? holdLabel : label}
      </span>
    </button>
  )
}
