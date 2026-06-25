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
import React, { useCallback, useState } from 'react'

import { OffAgenda } from '@shared/domain/types'

import { MarginLeaders } from '../components/MarginLeaders'
import { NudgePanel } from '../components/NudgePanel'
import { RunningSummaryPanel } from '../components/RunningSummaryPanel'
import { t } from '../i18n'
import { useAppStore } from '../store/appStore'
import type { ProposedDecision, ProposedAction } from '../store/appStore'

import { useLiveSession } from './useLiveSession'

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
  sourceSpanId: string
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
  sourceSpanId,
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
      data-leader-card={id}
      data-source-span-id={sourceSpanId}
      data-confirmed={isProposed ? 'false' : 'true'}
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
                sourceSpanId={d.sourceSpanId}
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
                text={
                  a.description !== undefined && a.description.length > 0
                    ? a.description
                    : t('live.items.action.untitled')
                }
                state={a.state}
                sourceSpanId={a.sourceSpanId}
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
  const captureMode = useAppStore((s) => s.captureMode)
  const loopbackState = useAppStore((s) => s.loopbackState)
  const setCaptureMode = useAppStore((s) => s.setCaptureMode)

  const proposedDecisions = useAppStore((s) => s.proposedDecisions)
  const proposedActions = useAppStore((s) => s.proposedActions)
  const confirmedDecisions = useAppStore((s) => s.confirmedDecisions)
  const confirmedActions = useAppStore((s) => s.confirmedActions)
  const agendaItems = useAppStore((s) => s.agendaItems)
  const setAgendaItems = useAppStore((s) => s.setAgendaItems)
  const participants = useAppStore((s) => s.participants)
  const activeMeeting = useAppStore((s) => s.activeMeeting)
  const liveMeetingId = useAppStore((s) => s.liveMeetingId)
  const setLiveMeetingId = useAppStore((s) => s.setLiveMeetingId)
  const meetingTitle = useAppStore((s) => s.meetingTitle)
  const setRoute = useAppStore((s) => s.setRoute)

  const confirmItem = useAppStore((s) => s.confirmItem)
  const removeProposedItem = useAppStore((s) => s.removeProposedItem)
  const addConfirmedItem = useAppStore((s) => s.addConfirmedItem)

  const nudges = useAppStore((s) => s.nudges)
  const dismissedNudgeIds = useAppStore((s) => s.dismissedNudgeIds)
  const dismissNudge = useAppStore((s) => s.dismissNudge)

  // --- Session orchestration (audio capture + IPC subscriptions) ---
  // Keyed on liveMeetingId (a recording session), not activeMeeting (which is
  // also set when a meeting is merely loaded for Review).
  const { audioLevel } = useLiveSession(liveMeetingId)

  // --- Marginalia leaders ---
  // The live-layout is the positioned container the leader overlay measures
  // within; the recompute key changes whenever spans or items change so the
  // curves are redrawn (resize is handled inside MarginLeaders).
  const liveLayoutRef = React.useRef<HTMLDivElement>(null)

  // --- Local UI state ---
  // Transcript is the live canvas: open by default, collapsible via the toggle.
  const [transcriptOpen, setTranscriptOpen] = useState(true)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [addingKind, setAddingKind] = useState<ItemKind | null>(null)
  const [endingMeeting, setEndingMeeting] = useState(false)
  // Inline edit state for a Proposed agenda item being groomed (ADR 0029).
  const [agendaEdit, setAgendaEdit] = useState<{ id: string; title: string } | null>(null)

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
      if (kind === 'decision') {
        await window.api.itemEditAndConfirm({ kind, id, updates: { rationale: text } })
      } else {
        const updates: { description?: string; owner?: string } = {}
        if (text.length > 0) updates.description = text
        if (owner.length > 0) updates.owner = owner
        await window.api.itemEditAndConfirm({ kind, id, updates })
      }
      confirmItem(kind, id)
      setEditState(null)
    } catch (err) {
      console.error('[LiveScreen] editAndConfirm failed:', err)
    }
  }, [editState, confirmItem])

  const handleEditCancel = useCallback(() => {
    setEditState(null)
  }, [])

  // --- Proposed agenda item grooming (ADR 0029) ---
  const handleAgendaConfirm = useCallback(
    async (id: string) => {
      try {
        await window.api.agendaItemConfirm({ agendaItemId: id })
        setAgendaItems(agendaItems.map((a) => (a.id === id ? { ...a, state: 'confirmed' } : a)))
      } catch (err) {
        console.error('[LiveScreen] agenda confirm failed:', err)
      }
    },
    [agendaItems, setAgendaItems],
  )

  const handleAgendaDismiss = useCallback(
    async (id: string) => {
      try {
        await window.api.agendaItemRemove({ agendaItemId: id })
        setAgendaItems(agendaItems.filter((a) => a.id !== id))
      } catch (err) {
        console.error('[LiveScreen] agenda dismiss failed:', err)
      }
    },
    [agendaItems, setAgendaItems],
  )

  const handleAgendaEditSave = useCallback(async () => {
    if (agendaEdit === null) return
    const { id, title } = agendaEdit
    const trimmed = title.trim()
    if (trimmed.length === 0) return
    const existing = agendaItems.find((a) => a.id === id)
    const topic = existing?.topic ?? trimmed
    try {
      await window.api.agendaItemEditAndConfirm({ agendaItemId: id, title: trimmed, topic })
      setAgendaItems(
        agendaItems.map((a) => (a.id === id ? { ...a, title: trimmed, state: 'confirmed' } : a)),
      )
      setAgendaEdit(null)
    } catch (err) {
      console.error('[LiveScreen] agenda editAndConfirm failed:', err)
    }
  }, [agendaEdit, agendaItems, setAgendaItems])

  const handleEndMeeting = useCallback(async () => {
    if (activeMeeting === null || endingMeeting) return
    setEndingMeeting(true)
    try {
      await window.api.meetingEnd({ meetingId: activeMeeting })
      // The recording session is over: clear the live id so useLiveSession tears
      // down audio capture. activeMeeting stays set so Review can read the meeting.
      setLiveMeetingId(null)
      // Navigation to 'review' happens when items:summaries arrives.
      // If the runtime has no provider, items:summaries may not fire — navigate anyway.
      setRoute('review')
    } catch (err) {
      console.error('[LiveScreen] meetingEnd failed:', err)
      setEndingMeeting(false)
    }
  }, [activeMeeting, endingMeeting, setLiveMeetingId, setRoute])

  const handleManualAdd = useCallback(
    async (kind: ItemKind, text: string) => {
      if (activeMeeting === null) return
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
              description: text,
              agendaItemId: OffAgenda.id,
              sourceSpanId: 'manual',
              status: 'open' as const,
            }
      try {
        const result = await window.api.itemCreateConfirmed({
          kind,
          meetingId: activeMeeting,
          item,
        })
        addConfirmedItem(kind, result)
        setAddingKind(null)
      } catch (err) {
        console.error('[LiveScreen] createConfirmed failed:', err)
      }
    },
    [activeMeeting, addConfirmedItem],
  )

  // --- Grouping ---
  // Confirmed agenda items are the routing buckets; Proposed items the agent
  // inferred live are groomed separately (ADR 0029) and only become buckets once
  // the note-taker confirms them.
  const allGroups = React.useMemo(() => {
    const groups = [
      ...agendaItems
        .filter((ai) => ai.state === 'confirmed')
        .map((ai) => ({ id: ai.id, title: ai.title })),
      { id: OffAgenda.id, title: t('live.items.offagenda.heading') },
    ]
    return groups
  }, [agendaItems])

  const proposedAgenda = React.useMemo(
    () => agendaItems.filter((ai) => ai.state === 'proposed'),
    [agendaItems],
  )

  // Redraw the leaders whenever the transcript or the item set changes.
  const leaderRecomputeKey = [
    transcriptSpans.length,
    proposedDecisions.length,
    proposedActions.length,
    confirmedDecisions.length,
    confirmedActions.length,
    transcriptOpen ? 1 : 0,
  ].join(':')

  // --- Render ---
  const isRecording = micPermission === 'granted'

  if (activeMeeting === null) {
    return (
      <main data-testid="screen-live" className="screen screen--live">
        <div className="live-noactive" data-testid="live-noactive">
          <p className="live-noactive__message">{t('live.noactive.message')}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setRoute('draft')
            }}
          >
            {t('live.noactive.action')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      data-testid="screen-live"
      className={`screen screen--live screen--live-items${isRecording ? ' screen--live--recording' : ''}`}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <header className="live-header">
        <div className="live-header__heading">
          {isRecording && <span className="live-rec-dot" aria-hidden="true" />}
          <h1 className="screen__title live-header__title">
            {meetingTitle.length > 0 ? meetingTitle : t('screen.live.title')}
          </h1>
        </div>
        <button
          type="button"
          className="btn btn--secondary live-end-btn"
          data-testid="end-meeting-btn"
          disabled={endingMeeting}
          onClick={() => {
            void handleEndMeeting()
          }}
        >
          {t('live.end.button')}
        </button>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Session controls (loopback toggle + mic status) */}
      {/* ------------------------------------------------------------------ */}
      <div className="live-controls">
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
            <div className="mic-active-row">
              <p className="mic-active-message" data-testid="mic-active-message">
                {t('live.mic.active')}
              </p>
              <div className="audio-level-meter" aria-hidden="true">
                <div
                  className="audio-level-bar"
                  style={{ width: String(Math.min(100, audioLevel * 400)) + '%' }}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="live-layout" ref={liveLayoutRef}>
        <MarginLeaders containerRef={liveLayoutRef} recomputeKey={leaderRecomputeKey} />

        <aside className="live-layout__margin">
          {/* ------------------------------------------------------------------ */}
          {/* Nudge panel (item 0019) */}
          {/* ------------------------------------------------------------------ */}
          <NudgePanel
            nudges={nudges}
            dismissedNudgeIds={dismissedNudgeIds}
            onDismiss={dismissNudge}
          />

          {/* ------------------------------------------------------------------ */}
          {/* Items panel — keyboard shortcut legend */}
          {/* ------------------------------------------------------------------ */}
          <p className="live-shortcuts-hint">{t('live.items.shortcuts')}</p>

          {/* ------------------------------------------------------------------ */}
          {/* Agenda groups */}
          {/* ------------------------------------------------------------------ */}
          <div className="live-groups">
            {/* Proposed agenda items (ADR 0029): dashed groups groomed inline. */}
            {proposedAgenda.map((item) => (
              <section
                key={item.id}
                className="live-group live-group--proposed"
                data-testid={`proposed-agenda-${item.id}`}
              >
                <header className="live-group__header">
                  <span className="live-group__marker live-group__marker--proposed">╌</span>
                  {agendaEdit?.id === item.id ? (
                    <input
                      className="form-input live-group__edit-input"
                      aria-label={t('live.agenda.edit.titleLabel')}
                      value={agendaEdit.title}
                      autoFocus
                      onChange={(e) => {
                        setAgendaEdit({ id: item.id, title: e.currentTarget.value })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleAgendaEditSave()
                        } else if (e.key === 'Escape') {
                          setAgendaEdit(null)
                        }
                      }}
                    />
                  ) : (
                    <h3 className="live-group__title">
                      {item.title}{' '}
                      <span className="live-group__proposed-tag">
                        {t('live.agenda.proposed.label')}
                      </span>
                    </h3>
                  )}
                  <span className="live-group__agenda-actions">
                    {agendaEdit?.id === item.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          onClick={() => void handleAgendaEditSave()}
                        >
                          {t('live.agenda.edit.save')}
                        </button>
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => {
                            setAgendaEdit(null)
                          }}
                        >
                          {t('live.agenda.edit.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          aria-label={t('live.agenda.confirm')}
                          onClick={() => void handleAgendaConfirm(item.id)}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="btn btn--small"
                          aria-label={t('live.agenda.edit')}
                          onClick={() => {
                            setAgendaEdit({ id: item.id, title: item.title })
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="btn btn--small"
                          aria-label={t('live.agenda.dismiss')}
                          onClick={() => void handleAgendaDismiss(item.id)}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </span>
                </header>
              </section>
            ))}

            {allGroups.map((group) => {
              const groupProposedDecisions = proposedDecisions.filter(
                (d) => d.agendaItemId === group.id,
              )
              const groupProposedActions = proposedActions.filter(
                (a) => a.agendaItemId === group.id,
              )
              const groupConfirmedDecisions = confirmedDecisions.filter(
                (d) => d.agendaItemId === group.id,
              )
              const groupConfirmedActions = confirmedActions.filter(
                (a) => a.agendaItemId === group.id,
              )

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
        </aside>

        {/* ------------------------------------------------------------------ */}
        {/* Transcript — the live canvas (left column, open by default) */}
        {/* ------------------------------------------------------------------ */}
        <section className="live-layout__transcript live-transcript-section screen__body">
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
                          data-span-id={span.id}
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
      </div>
    </main>
  )
}
