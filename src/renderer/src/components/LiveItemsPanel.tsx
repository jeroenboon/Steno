/**
 * LiveItemsPanel — the Live screen's decisions/actions surface (A1 split).
 *
 * The heart of the note-taker flow: the keyboard-shortcut legend, the live
 * agenda groups (Proposed items groomed inline per ADR 0029, plus the Confirmed
 * agenda buckets holding decisions/actions), and the manual-add bar. Owns its
 * inline-edit / add / agenda-grooming UI state and all the item + agenda
 * mutations; store-connected for the item, agenda and participant lists.
 *
 * Item mutations round-trip through main, which pushes the authoritative
 * items:changed the store reconciles from (ADR 0033) — no optimistic update.
 * Agenda grooming updates the store optimistically because there is no push.
 *
 * The leaf components (ItemCard, EditForm, AddForm, AgendaGroup) live here since
 * this is their only caller, mirroring how NudgePanel keeps NudgeCard internal.
 */

import React, { useCallback, useState } from 'react'

import { OffAgenda } from '@shared/domain/types'

import { t } from '../i18n'
import { callApi } from '../lib/callApi'
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
    <div
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
    </div>
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
    <div className="live-edit-form">
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
    </div>
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
    <div className="live-add-form">
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
    </div>
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
            {editState?.id === d.id && editState.kind === 'decision' && (
              <EditForm
                editState={editState}
                participants={editParticipants}
                onChange={onEditChange}
                onSave={onEditSave}
                onCancel={onEditCancel}
              />
            )}
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
            {editState?.id === a.id && editState.kind === 'action' && (
              <EditForm
                editState={editState}
                participants={editParticipants}
                onChange={onEditChange}
                onSave={onEditSave}
                onCancel={onEditCancel}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// LiveItemsPanel
// ---------------------------------------------------------------------------

export function LiveItemsPanel(): React.JSX.Element {
  const proposedDecisions = useAppStore((s) => s.proposedDecisions)
  const proposedActions = useAppStore((s) => s.proposedActions)
  const confirmedDecisions = useAppStore((s) => s.confirmedDecisions)
  const confirmedActions = useAppStore((s) => s.confirmedActions)
  const agendaItems = useAppStore((s) => s.agendaItems)
  const setAgendaItems = useAppStore((s) => s.setAgendaItems)
  const participants = useAppStore((s) => s.participants)
  const activeMeeting = useAppStore((s) => s.activeMeeting)
  const transcriptSpans = useAppStore((s) => s.transcriptSpans)

  const [editState, setEditState] = useState<EditState | null>(null)
  const [addingKind, setAddingKind] = useState<ItemKind | null>(null)
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
  const handleConfirm = useCallback(async (kind: ItemKind, id: string) => {
    await callApi('LiveItemsPanel confirm', () => window.api.itemConfirm({ kind, id }))
  }, [])

  const handleDismiss = useCallback(async (kind: ItemKind, id: string) => {
    await callApi('LiveItemsPanel dismiss', () => window.api.itemDismiss({ kind, id }))
  }, [])

  const handleEditOpen = useCallback((kind: ItemKind, id: string, text: string, owner: string) => {
    setEditState({ id, kind, text, owner })
  }, [])

  const handleEditChange = useCallback((field: 'text' | 'owner', value: string) => {
    setEditState((prev) => (prev !== null ? { ...prev, [field]: value } : null))
  }, [])

  const handleEditSave = useCallback(async () => {
    if (editState === null) return
    const { id, kind, text, owner } = editState
    const ok = await callApi('LiveItemsPanel editAndConfirm', () => {
      if (kind === 'decision') {
        return window.api.itemEditAndConfirm({ kind, id, updates: { rationale: text } })
      }
      const updates: { description?: string; owner?: string } = {}
      if (text.length > 0) updates.description = text
      if (owner.length > 0) updates.owner = owner
      return window.api.itemEditAndConfirm({ kind, id, updates })
    })
    if (ok) setEditState(null)
  }, [editState])

  const handleEditCancel = useCallback(() => {
    setEditState(null)
  }, [])

  // --- Proposed agenda item grooming (ADR 0029) ---
  const handleAgendaConfirm = useCallback(
    async (id: string) => {
      if (
        await callApi('LiveItemsPanel agenda confirm', () =>
          window.api.agendaItemConfirm({ agendaItemId: id }),
        )
      ) {
        setAgendaItems(agendaItems.map((a) => (a.id === id ? { ...a, state: 'confirmed' } : a)))
      }
    },
    [agendaItems, setAgendaItems],
  )

  const handleAgendaDismiss = useCallback(
    async (id: string) => {
      if (
        await callApi('LiveItemsPanel agenda dismiss', () =>
          window.api.agendaItemRemove({ agendaItemId: id }),
        )
      ) {
        setAgendaItems(agendaItems.filter((a) => a.id !== id))
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
    const ok = await callApi('LiveItemsPanel agenda editAndConfirm', () =>
      window.api.agendaItemEditAndConfirm({ agendaItemId: id, title: trimmed, topic }),
    )
    if (ok) {
      setAgendaItems(
        agendaItems.map((a) => (a.id === id ? { ...a, title: trimmed, state: 'confirmed' } : a)),
      )
      setAgendaEdit(null)
    }
  }, [agendaEdit, agendaItems, setAgendaItems])

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
      const ok = await callApi('LiveItemsPanel createConfirmed', () =>
        window.api.itemCreateConfirmed({
          kind,
          meetingId: activeMeeting,
          item,
        }),
      )
      if (ok) setAddingKind(null)
    },
    [activeMeeting],
  )

  // --- Grouping ---
  // Confirmed agenda items are the routing buckets; Proposed items the agent
  // inferred live are groomed separately (ADR 0029) and only become buckets once
  // the note-taker confirms them.
  const allGroups = React.useMemo(() => {
    return [
      ...agendaItems
        .filter((ai) => ai.state === 'confirmed')
        .map((ai) => ({ id: ai.id, title: ai.title })),
      { id: OffAgenda.id, title: t('live.items.offagenda.heading') },
    ]
  }, [agendaItems])

  const proposedAgenda = React.useMemo(
    () => agendaItems.filter((ai) => ai.state === 'proposed'),
    [agendaItems],
  )

  return (
    <>
      {/* Keyboard shortcut legend */}
      <p className="live-shortcuts-hint">{t('live.items.shortcuts')}</p>

      {/* Agenda groups */}
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
                      className="btn btn--small btn--ghost"
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
                      className="btn btn--small btn--secondary"
                      aria-label={t('live.agenda.edit')}
                      onClick={() => {
                        setAgendaEdit({ id: item.id, title: item.title })
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
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

      {/* Manual add bar */}
      <section className="live-add-bar screen__body">
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
          <div className="live-add-bar__buttons">
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
          </div>
        )}
      </section>
    </>
  )
}
