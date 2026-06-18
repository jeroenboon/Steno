/**
 * Live screen — item 0018 (full items UI + transcript toggle).
 *
 * Layout:
 *   ┌─ header ──────────────────────────────────────┐
 *   │  title + subtitle + session controls           │
 *   ├─ agenda groups ───────────────────────────────┤
 *   │  [Q3 Review]                                   │
 *   │    ╌ Proposed decision (dashed pencil border)  │
 *   │    ✓ Confirmed action (solid myrtle border)    │
 *   │  [Off-agenda]                                  │
 *   │    …                                           │
 *   ├─ manual add bar ──────────────────────────────┤
 *   │  + Beslissing toevoegen  + Actie toevoegen     │
 *   ├─ transcript toggle ───────────────────────────┤
 *   │  [▸ Transcriptie tonen] (collapsed by default) │
 *   └───────────────────────────────────────────────┘
 *
 * Keyboard shortcuts (on focused items):
 *   Enter  → confirm
 *   Delete → dismiss
 *   E      → open inline edit
 *
 * Framer Motion:
 *   - Items animate in (slide-up + fade) on arrival
 *   - Items animate out (fade + collapse) on retraction
 */

import { AnimatePresence, motion } from 'framer-motion'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { OffAgenda } from '@shared/domain/types'
import {
  ItemsChangedPayloadSchema,
  NudgesChangedPayloadSchema,
  SummaryChangedPayloadSchema,
  TranscriptSpanSchema,
} from '@shared/ipc'

import { NudgePanel } from '../components/NudgePanel'
import { RunningSummaryPanel } from '../components/RunningSummaryPanel'
import { t } from '../i18n'
import { AudioCaptureService, PermissionDeniedError } from '../services/AudioCaptureService'
import { useAppStore } from '../store/appStore'
import type { ProposedDecision, ProposedAction } from '../store/appStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ItemKind = 'decision' | 'action'

interface EditState {
  id: string
  kind: ItemKind
  text: string
  owner: string
}

// ---------------------------------------------------------------------------
// Low-confidence threshold (soft flag, not a hard reject)
// ---------------------------------------------------------------------------

const LOW_CONFIDENCE_THRESHOLD = 0.6

// ---------------------------------------------------------------------------
// Item card component
// ---------------------------------------------------------------------------

interface ItemCardProps {
  id: string
  kind: ItemKind
  text: string
  state: 'proposed' | 'confirmed'
  sourceSpanText: string | undefined
  ownerName: string | undefined
  onConfirm: (kind: ItemKind, id: string) => void
  onDismiss: (kind: ItemKind, id: string) => void
  onEdit: (kind: ItemKind, id: string, text: string, owner: string) => void
}

function ItemCard({
  id,
  kind,
  text,
  state,
  sourceSpanText,
  ownerName,
  onConfirm,
  onDismiss,
  onEdit,
}: ItemCardProps): React.JSX.Element {
  const isProposed = state === 'proposed'

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm(kind, id)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Backspace only when the item itself is focused (not an input inside it)
        if (e.target === e.currentTarget) {
          e.preventDefault()
          onDismiss(kind, id)
        }
      } else if (e.key === 'e' || e.key === 'E') {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          onEdit(kind, id, text, ownerName ?? '')
        }
      }
    },
    [kind, id, text, ownerName, onConfirm, onDismiss, onEdit],
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={`live-item live-item--${kind} ${isProposed ? 'live-item--proposed' : 'live-item--confirmed'}`}
      data-testid={`item-${id}`}
      data-state={state}
      tabIndex={0}
      role="listitem"
      aria-label={`${kind === 'decision' ? 'Beslissing' : 'Actie'}: ${text}`}
      onKeyDown={handleKeyDown}
    >
      {/* State badge */}
      <span className={`live-item__badge live-item__badge--${state}`}>
        {isProposed ? '◌' : '✓'}
      </span>

      {/* Main content */}
      <div className="live-item__body">
        <p className="live-item__text">{text}</p>

        {/* Source span */}
        {sourceSpanText !== undefined && (
          <p className="live-item__source">
            <span className="live-item__source-label">{t('live.items.source')}: </span>
            <span className="live-item__source-text">&ldquo;{sourceSpanText}&rdquo;</span>
          </p>
        )}

        {/* Owner (actions) */}
        {kind === 'action' && (
          <p className="live-item__owner">
            <span className="live-item__owner-icon">→</span>{' '}
            {ownerName ?? t('live.items.owner.none')}
          </p>
        )}
      </div>

      {/* Actions (proposed items only) */}
      {isProposed && (
        <div className="live-item__actions" role="group" aria-label="Item acties">
          <button
            type="button"
            className="live-item__btn live-item__btn--confirm"
            data-testid={`confirm-${id}`}
            title={`${t('live.items.confirm')} (Enter)`}
            aria-label={t('live.items.confirm')}
            onClick={() => {
              onConfirm(kind, id)
            }}
          >
            ✓
          </button>
          <button
            type="button"
            className="live-item__btn live-item__btn--edit"
            data-testid={`edit-${id}`}
            title={`${t('live.items.edit')} (E)`}
            aria-label={t('live.items.edit')}
            onClick={() => {
              onEdit(kind, id, text, ownerName ?? '')
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="live-item__btn live-item__btn--dismiss"
            data-testid={`dismiss-${id}`}
            title={`${t('live.items.dismiss')} (Del)`}
            aria-label={t('live.items.dismiss')}
            onClick={() => {
              onDismiss(kind, id)
            }}
          >
            ✕
          </button>
        </div>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Inline edit form
// ---------------------------------------------------------------------------

interface EditFormProps {
  editState: EditState
  participants: { id: string; name: string }[]
  onChange: (field: 'text' | 'owner', value: string) => void
  onSave: () => void
  onCancel: () => void
}

function EditForm({
  editState,
  participants,
  onChange,
  onSave,
  onCancel,
}: EditFormProps): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="live-edit-form"
    >
      <textarea
        className="live-edit-form__textarea"
        data-testid={`edit-textarea-${editState.id}`}
        value={editState.text}
        onChange={(e) => {
          onChange('text', e.target.value)
        }}
        rows={3}
        autoFocus
      />

      {editState.kind === 'action' && (
        <div className="live-edit-form__row">
          <label className="live-edit-form__label" htmlFor={`owner-${editState.id}`}>
            {t('live.items.owner')}
          </label>
          <select
            id={`owner-${editState.id}`}
            className="live-edit-form__select"
            value={editState.owner}
            onChange={(e) => {
              onChange('owner', e.target.value)
            }}
          >
            <option value="">{t('live.items.owner.none')}</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="live-edit-form__controls">
        <button type="button" className="btn" data-testid={`save-${editState.id}`} onClick={onSave}>
          {t('live.items.save')}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          {t('live.items.cancel')}
        </button>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Manual add form
// ---------------------------------------------------------------------------

interface AddFormProps {
  kind: ItemKind
  onSubmit: (kind: ItemKind, text: string) => void
  onCancel: () => void
}

function AddForm({ kind, onSubmit, onCancel }: AddFormProps): React.JSX.Element {
  const [text, setText] = useState('')

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="live-add-form"
    >
      <input
        type="text"
        className="live-add-form__input"
        data-testid={kind === 'decision' ? 'new-decision-input' : 'new-action-input'}
        placeholder={
          kind === 'decision'
            ? t('live.items.add.decision.placeholder')
            : t('live.items.add.action.placeholder')
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim().length > 0) {
            onSubmit(kind, text.trim())
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
        autoFocus
      />
      <div className="live-add-form__controls">
        <button
          type="button"
          className="btn"
          data-testid={kind === 'decision' ? 'submit-new-decision' : 'submit-new-action'}
          disabled={text.trim().length === 0}
          onClick={() => {
            if (text.trim().length > 0) onSubmit(kind, text.trim())
          }}
        >
          {t('live.items.save')}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          {t('live.items.cancel')}
        </button>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Agenda group section
// ---------------------------------------------------------------------------

interface AgendaGroupProps {
  agendaTitle: string
  agendaId: string
  decisions: ProposedDecision[]
  actions: ProposedAction[]
  confirmedDecisions: ProposedDecision[]
  confirmedActions: ProposedAction[]
  transcriptSpanMap: Map<string, string>
  participantMap: Map<string, string>
  onConfirm: (kind: ItemKind, id: string) => void
  onDismiss: (kind: ItemKind, id: string) => void
  onEdit: (kind: ItemKind, id: string, text: string, owner: string) => void
  editState: EditState | null
  editParticipants: { id: string; name: string }[]
  onEditChange: (field: 'text' | 'owner', value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
}

function AgendaGroup({
  agendaTitle,
  agendaId,
  decisions,
  actions,
  confirmedDecisions,
  confirmedActions,
  transcriptSpanMap,
  participantMap,
  onConfirm,
  onDismiss,
  onEdit,
  editState,
  editParticipants,
  onEditChange,
  onEditSave,
  onEditCancel,
}: AgendaGroupProps): React.JSX.Element | null {
  const allDecisions = [...decisions, ...confirmedDecisions]
  const allActions = [...actions, ...confirmedActions]

  if (allDecisions.length === 0 && allActions.length === 0) return null

  const isOffAgenda = agendaId === OffAgenda.id

  return (
    <section className="live-group" data-testid={`group-${agendaId}`}>
      <header className="live-group__header">
        <span className={`live-group__marker ${isOffAgenda ? 'live-group__marker--off' : ''}`}>
          {isOffAgenda ? '○' : '●'}
        </span>
        <h3 className="live-group__title">{agendaTitle}</h3>
        <span className="live-group__count">{allDecisions.length + allActions.length}</span>
      </header>

      <div className="live-group__items" role="list">
        <AnimatePresence mode="popLayout">
          {allDecisions.map((d) => (
            <React.Fragment key={d.id}>
              <ItemCard
                id={d.id}
                kind="decision"
                text={d.rationale}
                state={d.state}
                sourceSpanText={transcriptSpanMap.get(d.sourceSpanId)}
                ownerName={undefined}
                onConfirm={onConfirm}
                onDismiss={onDismiss}
                onEdit={onEdit}
              />
              <AnimatePresence>
                {editState?.id === d.id && editState.kind === 'decision' && (
                  <EditForm
                    editState={editState}
                    participants={editParticipants}
                    onChange={onEditChange}
                    onSave={onEditSave}
                    onCancel={onEditCancel}
                  />
                )}
              </AnimatePresence>
            </React.Fragment>
          ))}

          {allActions.map((a) => (
            <React.Fragment key={a.id}>
              <ItemCard
                id={a.id}
                kind="action"
                text={`Actie${a.owner !== undefined ? ` → ${participantMap.get(a.owner) ?? a.owner}` : ''}`}
                state={a.state}
                sourceSpanText={transcriptSpanMap.get(a.sourceSpanId)}
                ownerName={
                  a.owner !== undefined ? (participantMap.get(a.owner) ?? a.owner) : undefined
                }
                onConfirm={onConfirm}
                onDismiss={onDismiss}
                onEdit={onEdit}
              />
              <AnimatePresence>
                {editState?.id === a.id && editState.kind === 'action' && (
                  <EditForm
                    editState={editState}
                    participants={editParticipants}
                    onChange={onEditChange}
                    onSave={onEditSave}
                    onCancel={onEditCancel}
                  />
                )}
              </AnimatePresence>
            </React.Fragment>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main LiveScreen
// ---------------------------------------------------------------------------

export function LiveScreen(): React.JSX.Element {
  // --- Store ---
  const micPermission = useAppStore((s) => s.micPermission)
  const transcriptSpans = useAppStore((s) => s.transcriptSpans)
  const setMicPermission = useAppStore((s) => s.setMicPermission)
  const addTranscriptSpan = useAppStore((s) => s.addTranscriptSpan)
  const captureMode = useAppStore((s) => s.captureMode)
  const loopbackState = useAppStore((s) => s.loopbackState)
  const setCaptureMode = useAppStore((s) => s.setCaptureMode)
  const setLoopbackState = useAppStore((s) => s.setLoopbackState)

  const proposedDecisions = useAppStore((s) => s.proposedDecisions)
  const proposedActions = useAppStore((s) => s.proposedActions)
  const confirmedDecisions = useAppStore((s) => s.confirmedDecisions)
  const confirmedActions = useAppStore((s) => s.confirmedActions)
  const agendaItems = useAppStore((s) => s.agendaItems)
  const participants = useAppStore((s) => s.participants)
  const activeMeeting = useAppStore((s) => s.activeMeeting)

  const mergeProposedItems = useAppStore((s) => s.mergeProposedItems)
  const confirmItem = useAppStore((s) => s.confirmItem)
  const removeProposedItem = useAppStore((s) => s.removeProposedItem)
  const addConfirmedItem = useAppStore((s) => s.addConfirmedItem)

  const nudges = useAppStore((s) => s.nudges)
  const dismissedNudgeIds = useAppStore((s) => s.dismissedNudgeIds)
  const setNudges = useAppStore((s) => s.setNudges)
  const dismissNudge = useAppStore((s) => s.dismissNudge)
  const setRunningSummary = useAppStore((s) => s.setRunningSummary)

  // --- Local UI state ---
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [addingKind, setAddingKind] = useState<ItemKind | null>(null)

  // --- Refs ---
  const serviceRef = useRef<AudioCaptureService | null>(null)

  // --- Derived maps ---
  const transcriptSpanMap = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const span of transcriptSpans) {
      m.set(span.id, span.text)
    }
    return m
  }, [transcriptSpans])

  const participantMap = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const p of participants) {
      m.set(p.id, p.name)
    }
    return m
  }, [participants])

  // --- IPC subscriptions ---
  useEffect(() => {
    const service = new AudioCaptureService()
    serviceRef.current = service

    // Transcript spans
    const unsubSpan = window.api.onTranscriptSpan((raw) => {
      const result = TranscriptSpanSchema.safeParse(raw)
      if (result.success) {
        addTranscriptSpan(result.data)
      }
    })

    // Proposed items
    const unsubItems = window.api.onItemsChanged((raw) => {
      const result = ItemsChangedPayloadSchema.safeParse(raw)
      if (result.success) {
        const payload = result.data
        mergeProposedItems({
          decisions: payload.decisions,
          actions: payload.actions,
        })
      }
    })

    // Nudges (item 0019)
    const unsubNudges = window.api.onNudgesChanged((raw) => {
      const result = NudgesChangedPayloadSchema.safeParse(raw)
      if (result.success) {
        setNudges(result.data.nudges)
      }
    })

    // Running summary (item 0020)
    const unsubSummary = window.api.onSummaryChanged((raw) => {
      const result = SummaryChangedPayloadSchema.safeParse(raw)
      if (result.success) {
        setRunningSummary(result.data.summary)
      }
    })

    // Discussion summaries (logged but not displayed live — item 0021)
    const unsubSummaries = window.api.onItemsSummaries(() => {
      // Post-meeting summaries handled in item 0021 Review screen
    })

    // Start audio capture
    void service
      .start(captureMode)
      .then((result) => {
        setMicPermission('granted')
        setLoopbackState(result.loopbackState)
      })
      .catch((err: unknown) => {
        if (err instanceof PermissionDeniedError) {
          setMicPermission('denied')
        } else {
          setMicPermission('denied')
          console.error('[LiveScreen] Audio capture error:', err)
        }
      })

    return () => {
      unsubSpan()
      unsubItems()
      unsubNudges()
      unsubSummary()
      unsubSummaries()
      void service.stop().catch((err: unknown) => {
        console.error('[LiveScreen] Error stopping audio capture:', err)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addTranscriptSpan,
    setMicPermission,
    setLoopbackState,
    mergeProposedItems,
    setNudges,
    setRunningSummary,
  ])

  // --- Item actions ---
  const handleConfirm = useCallback(
    async (kind: ItemKind, id: string) => {
      try {
        await window.api.itemConfirm({ kind, id })
        confirmItem(kind, id)
      } catch (err) {
        console.error('[LiveScreen] confirm failed:', err)
      }
    },
    [confirmItem],
  )

  const handleDismiss = useCallback(
    async (kind: ItemKind, id: string) => {
      try {
        await window.api.itemDismiss({ kind, id })
        removeProposedItem(kind, id)
      } catch (err) {
        console.error('[LiveScreen] dismiss failed:', err)
      }
    },
    [removeProposedItem],
  )

  const handleEditOpen = useCallback((kind: ItemKind, id: string, text: string, owner: string) => {
    setEditState({ id, kind, text, owner })
  }, [])

  const handleEditChange = useCallback((field: 'text' | 'owner', value: string) => {
    setEditState((prev) => (prev !== null ? { ...prev, [field]: value } : null))
  }, [])

  const handleEditSave = useCallback(async () => {
    if (editState === null) return
    const { id, kind, text, owner } = editState
    try {
      const updates =
        kind === 'decision' ? { rationale: text } : { owner: owner.length > 0 ? owner : undefined }
      await window.api.itemEditAndConfirm({ kind, id, updates })
      confirmItem(kind, id)
      setEditState(null)
    } catch (err) {
      console.error('[LiveScreen] editAndConfirm failed:', err)
    }
  }, [editState, confirmItem])

  const handleEditCancel = useCallback(() => {
    setEditState(null)
  }, [])

  const handleManualAdd = useCallback(
    async (kind: ItemKind, text: string) => {
      const meetingId = activeMeeting ?? 'active-session'
      const newId = crypto.randomUUID()
      const item =
        kind === 'decision'
          ? {
              id: newId,
              rationale: text,
              agendaItemId: OffAgenda.id,
              sourceSpanId: 'manual',
            }
          : {
              id: newId,
              agendaItemId: OffAgenda.id,
              sourceSpanId: 'manual',
              status: 'open' as const,
            }
      try {
        const result = await window.api.itemCreateConfirmed({ kind, meetingId, item })
        addConfirmedItem(kind, result)
        setAddingKind(null)
      } catch (err) {
        console.error('[LiveScreen] createConfirmed failed:', err)
      }
    },
    [activeMeeting, addConfirmedItem],
  )

  // --- Grouping ---
  // Build full list of groups: agenda items + off-agenda
  const allGroups = React.useMemo(() => {
    const groups = [
      ...agendaItems.map((ai) => ({ id: ai.id, title: ai.title })),
      { id: OffAgenda.id, title: t('live.items.offagenda.heading') },
    ]
    return groups
  }, [agendaItems])

  // --- Render ---
  return (
    <main data-testid="screen-live" className="screen screen--live screen--live-items">
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.live.title')}</h1>
        <p className="screen__subtitle">{t('screen.live.subtitle')}</p>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Session controls (loopback toggle + mic status) */}
      {/* ------------------------------------------------------------------ */}
      <section className="screen__body screen__body--loopback-toggle">
        <label htmlFor="capture-mode-select" className="loopback-toggle__label">
          {t('live.loopback.toggle.label')}
        </label>
        <select
          id="capture-mode-select"
          data-testid="capture-mode-select"
          value={captureMode}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'remote' || value === 'mic-only') {
              setCaptureMode(value)
            }
          }}
          disabled={micPermission !== 'unknown'}
          className="loopback-toggle__select"
        >
          <option value="remote">{t('live.loopback.mode.remote')}</option>
          <option value="mic-only">{t('live.loopback.mode.mic-only')}</option>
        </select>

        {loopbackState === 'denied' && (
          <p
            className="loopback-status loopback-status--denied"
            role="status"
            data-testid="loopback-denied-message"
          >
            {t('live.loopback.state.denied')}
          </p>
        )}
        {loopbackState === 'active' && (
          <p
            className="loopback-status loopback-status--active"
            role="status"
            data-testid="loopback-active-message"
          >
            {t('live.loopback.state.active')}
          </p>
        )}
        {loopbackState === 'off' && (
          <p
            className="loopback-status loopback-status--off"
            role="status"
            data-testid="loopback-off-message"
          >
            {t('live.loopback.state.off')}
          </p>
        )}
      </section>

      <section
        className="screen__body"
        data-testid="mic-status"
        data-mic-permission={micPermission}
      >
        {micPermission === 'denied' && (
          <p className="mic-denied-message" role="alert" data-testid="mic-denied-message">
            {t('live.mic.denied')}
          </p>
        )}
        {micPermission === 'unknown' && (
          <p className="mic-starting-message" data-testid="mic-starting-message">
            {t('live.mic.starting')}
          </p>
        )}
        {micPermission === 'granted' && (
          <p className="mic-active-message" data-testid="mic-active-message">
            {t('live.mic.active')}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Nudge panel (item 0019) */}
      {/* ------------------------------------------------------------------ */}
      <NudgePanel nudges={nudges} dismissedNudgeIds={dismissedNudgeIds} onDismiss={dismissNudge} />

      {/* ------------------------------------------------------------------ */}
      {/* Items panel — keyboard shortcut legend */}
      {/* ------------------------------------------------------------------ */}
      <p className="live-shortcuts-hint">{t('live.items.shortcuts')}</p>

      {/* ------------------------------------------------------------------ */}
      {/* Agenda groups */}
      {/* ------------------------------------------------------------------ */}
      <div className="live-groups">
        {allGroups.map((group) => {
          const groupProposedDecisions = proposedDecisions.filter(
            (d) => d.agendaItemId === group.id,
          )
          const groupProposedActions = proposedActions.filter((a) => a.agendaItemId === group.id)
          const groupConfirmedDecisions = confirmedDecisions.filter(
            (d) => d.agendaItemId === group.id,
          )
          const groupConfirmedActions = confirmedActions.filter((a) => a.agendaItemId === group.id)

          return (
            <AgendaGroup
              key={group.id}
              agendaId={group.id}
              agendaTitle={group.title}
              decisions={groupProposedDecisions}
              actions={groupProposedActions}
              confirmedDecisions={groupConfirmedDecisions}
              confirmedActions={groupConfirmedActions}
              transcriptSpanMap={transcriptSpanMap}
              participantMap={participantMap}
              onConfirm={(kind, id) => void handleConfirm(kind, id)}
              onDismiss={(kind, id) => void handleDismiss(kind, id)}
              onEdit={handleEditOpen}
              editState={editState}
              editParticipants={participants}
              onEditChange={handleEditChange}
              onEditSave={() => void handleEditSave()}
              onEditCancel={handleEditCancel}
            />
          )
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Manual add bar */}
      {/* ------------------------------------------------------------------ */}
      <section className="live-add-bar screen__body">
        <AnimatePresence mode="wait">
          {addingKind !== null ? (
            <AddForm
              key={addingKind}
              kind={addingKind}
              onSubmit={(kind, text) => void handleManualAdd(kind, text)}
              onCancel={() => {
                setAddingKind(null)
              }}
            />
          ) : (
            <motion.div
              key="add-buttons"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="live-add-bar__buttons"
            >
              <button
                type="button"
                className="btn btn--secondary live-add-bar__btn"
                data-testid="add-decision-btn"
                onClick={() => {
                  setAddingKind('decision')
                }}
              >
                + {t('live.items.add.decision')}
              </button>
              <button
                type="button"
                className="btn btn--secondary live-add-bar__btn"
                data-testid="add-action-btn"
                onClick={() => {
                  setAddingKind('action')
                }}
              >
                + {t('live.items.add.action')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Running summary panel (item 0020) */}
      {/* ------------------------------------------------------------------ */}
      <RunningSummaryPanel />

      {/* ------------------------------------------------------------------ */}
      {/* Collapsible transcript pane (collapsed by default) */}
      {/* ------------------------------------------------------------------ */}
      <section className="live-transcript-section screen__body">
        <button
          type="button"
          className="live-transcript__toggle"
          data-testid="transcript-toggle"
          aria-expanded={transcriptOpen}
          onClick={() => {
            setTranscriptOpen((o) => !o)
          }}
        >
          <span className="live-transcript__toggle-icon">{transcriptOpen ? '▾' : '▸'}</span>
          {transcriptOpen ? t('live.transcript.toggle.hide') : t('live.transcript.toggle.show')}
        </button>

        <AnimatePresence>
          {transcriptOpen && (
            <motion.div
              key="transcript-pane"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="live-transcript__pane"
            >
              <h2 className="transcript__heading">{t('live.transcript.heading')}</h2>
              {transcriptSpans.length === 0 ? (
                <p className="transcript__empty" data-testid="transcript-empty">
                  {t('live.transcript.empty')}
                </p>
              ) : (
                <ul className="transcript__list" data-testid="transcript-list">
                  {transcriptSpans.map((span) => {
                    const isLowConfidence =
                      span.confidence !== undefined && span.confidence < LOW_CONFIDENCE_THRESHOLD
                    return (
                      <li
                        key={span.id}
                        data-testid={`transcript-span-${span.id}`}
                        data-low-confidence={isLowConfidence ? 'true' : undefined}
                        className={[
                          'transcript__span',
                          span.isFinal === false ? 'transcript__span--interim' : '',
                          isLowConfidence ? 'transcript__span--low-confidence' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span className="transcript__text">{span.text}</span>
                        {span.isFinal === false && (
                          <span className="transcript__interim-label">
                            {t('live.transcript.interim')}
                          </span>
                        )}
                        {isLowConfidence && (
                          <span
                            className="transcript__low-confidence-flag"
                            title={t('live.items.low-confidence')}
                          >
                            ~
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  )
}
