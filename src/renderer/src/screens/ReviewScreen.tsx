/**
 * Review screen — item 0021 (full implementation).
 *
 * Layout per agenda item:
 *   ┌─ [Agenda item title] ──────────────────────────────┐
 *   │  Discussiesamenvatting (Discussion Summary text)    │
 *   │  ─ Beslissingen ─────────────────────────────────  │
 *   │    [decision card] (editable)                       │
 *   │  ─ Acties ───────────────────────────────────────  │
 *   │    [action card] (editable)                         │
 *   └──────────────────────────────────────────────────  ┘
 *
 * Off-agenda items rendered last without a Discussion Summary.
 * All items remain editable after a meeting ends (note-taker corrects).
 */

import React, { useCallback, useState } from 'react'

import { OffAgenda } from '@shared/domain/types'
import type { DiscussionSummary } from '@shared/domain/types'
import { toMarkdown, toJson } from '@shared/export/meetingExporter'

import { t } from '../i18n'
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
// Item card (read mode) with Edit button
// ---------------------------------------------------------------------------

interface ReviewItemCardProps {
  id: string
  kind: ItemKind
  text: string
  ownerName: string | undefined
  onEdit: (kind: ItemKind, id: string, text: string, owner: string) => void
}

function ReviewItemCard({
  id,
  kind,
  text,
  ownerName,
  onEdit,
}: ReviewItemCardProps): React.JSX.Element {
  return (
    <div
      className={`review-item-card review-item-card--${kind}`}
      data-testid={`review-${kind}-${id}`}
    >
      <p className="review-item-card__text">{text}</p>
      {ownerName !== undefined && (
        <p className="review-item-card__owner">
          <span className="review-item-card__owner-label">{t('review.items.owner')}: </span>
          {ownerName}
        </p>
      )}
      <button
        type="button"
        className="btn btn--secondary review-item-card__edit"
        data-testid={`review-edit-${kind}-${id}`}
        onClick={() => {
          onEdit(kind, id, text, ownerName ?? '')
        }}
      >
        {t('review.items.edit')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline edit form
// ---------------------------------------------------------------------------

interface ReviewEditFormProps {
  editState: EditState
  participants: { id: string; name: string }[]
  onChange: (field: 'text' | 'owner', value: string) => void
  onSave: () => void
  onCancel: () => void
}

function ReviewEditForm({
  editState,
  participants,
  onChange,
  onSave,
  onCancel,
}: ReviewEditFormProps): React.JSX.Element {
  return (
    <div className="review-edit-form" data-testid={`review-edit-form-${editState.id}`}>
      <textarea
        className="review-edit-form__input"
        data-testid={`review-edit-input-${editState.id}`}
        value={editState.text}
        onChange={(e) => {
          onChange('text', e.target.value)
        }}
        rows={3}
      />
      {editState.kind === 'action' && (
        <select
          className="review-edit-form__owner"
          data-testid={`review-edit-owner-${editState.id}`}
          value={editState.owner}
          onChange={(e) => {
            onChange('owner', e.target.value)
          }}
        >
          <option value="">{t('review.items.owner.none')}</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <div className="review-edit-form__actions">
        <button
          type="button"
          className="btn"
          data-testid={`review-save-${editState.id}`}
          onClick={onSave}
        >
          {t('review.items.save')}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid={`review-cancel-${editState.id}`}
          onClick={onCancel}
        >
          {t('review.items.cancel')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agenda group: summary + decisions + actions
// ---------------------------------------------------------------------------

interface ReviewGroupProps {
  agendaId: string
  agendaTitle: string
  summary: DiscussionSummary | undefined
  decisions: ProposedDecision[]
  actions: ProposedAction[]
  participantMap: Map<string, string>
  participants: { id: string; name: string }[]
  editState: EditState | null
  onEdit: (kind: ItemKind, id: string, text: string, owner: string) => void
  onEditChange: (field: 'text' | 'owner', value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
}

function ReviewGroup({
  agendaId,
  agendaTitle,
  summary,
  decisions,
  actions,
  participantMap,
  participants,
  editState,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
}: ReviewGroupProps): React.JSX.Element {
  const hasItems = decisions.length > 0 || actions.length > 0

  return (
    <section className="review-group" data-testid={`review-group-${agendaId}`}>
      <h2 className="review-group__title">{agendaTitle}</h2>

      {/* Discussion Summary */}
      {summary !== undefined && (
        <div className="review-summary" data-testid={`review-summary-${agendaId}`}>
          <h3 className="review-summary__heading">{t('review.summary.heading')}</h3>
          <p className="review-summary__text">{summary.text}</p>
        </div>
      )}

      {!hasItems && (
        <p className="review-items-empty" data-testid="review-items-empty">
          {t('review.items.empty')}
        </p>
      )}

      {decisions.length > 0 && (
        <div className="review-items-section">
          <h3 className="review-items-section__heading">{t('review.items.decisions.heading')}</h3>
          {decisions.map((d) => (
            <React.Fragment key={d.id}>
              {editState?.id === d.id && editState.kind === 'decision' ? (
                <ReviewEditForm
                  editState={editState}
                  participants={participants}
                  onChange={onEditChange}
                  onSave={onEditSave}
                  onCancel={onEditCancel}
                />
              ) : (
                <ReviewItemCard
                  id={d.id}
                  kind="decision"
                  text={d.rationale}
                  ownerName={undefined}
                  onEdit={onEdit}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="review-items-section">
          <h3 className="review-items-section__heading">{t('review.items.actions.heading')}</h3>
          {actions.map((a) => (
            <React.Fragment key={a.id}>
              {editState?.id === a.id && editState.kind === 'action' ? (
                <ReviewEditForm
                  editState={editState}
                  participants={participants}
                  onChange={onEditChange}
                  onSave={onEditSave}
                  onCancel={onEditCancel}
                />
              ) : (
                <ReviewItemCard
                  id={a.id}
                  kind="action"
                  text={
                    a.description !== undefined && a.description.length > 0
                      ? a.description
                      : t('live.items.action.untitled')
                  }
                  ownerName={
                    a.owner !== undefined ? (participantMap.get(a.owner) ?? a.owner) : undefined
                  }
                  onEdit={onEdit}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ReviewScreen
// ---------------------------------------------------------------------------

export function ReviewScreen(): React.JSX.Element {
  const agendaItems = useAppStore((s) => s.agendaItems)
  const participants = useAppStore((s) => s.participants)
  const confirmedDecisions = useAppStore((s) => s.confirmedDecisions)
  const confirmedActions = useAppStore((s) => s.confirmedActions)
  const discussionSummaries = useAppStore((s) => s.discussionSummaries)
  const confirmItem = useAppStore((s) => s.confirmItem)
  const meetingTitle = useAppStore((s) => s.meetingTitle)
  const meetingCreatedAt = useAppStore((s) => s.meetingCreatedAt)
  const meetingSource = useAppStore((s) => s.meetingSource)

  const [editState, setEditState] = useState<EditState | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)

  const participantMap = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const p of participants) {
      m.set(p.id, p.name)
    }
    return m
  }, [participants])

  // Build full group list: agenda items + off-agenda
  const allGroups = React.useMemo(() => {
    return [
      ...agendaItems.map((ai) => ({ id: ai.id, title: ai.title })),
      { id: OffAgenda.id, title: t('review.items.offagenda.heading') },
    ]
  }, [agendaItems])

  const handleEdit = useCallback((kind: ItemKind, id: string, text: string, owner: string) => {
    setEditState({ id, kind, text, owner })
  }, [])

  const handleEditChange = useCallback((field: 'text' | 'owner', value: string) => {
    setEditState((prev) => (prev !== null ? { ...prev, [field]: value } : null))
  }, [])

  const handleEditSave = useCallback(async () => {
    if (editState === null) return

    try {
      if (editState.kind === 'decision') {
        const result = await window.api.itemEditAndConfirm({
          kind: 'decision',
          id: editState.id,
          updates: { rationale: editState.text },
        })
        const updated = result as ProposedDecision
        useAppStore.setState((state) => ({
          confirmedDecisions: state.confirmedDecisions.map((d) =>
            d.id === editState.id ? { ...d, rationale: updated.rationale } : d,
          ),
        }))
        confirmItem('decision', editState.id)
      } else {
        const updates: { description?: string; owner?: string } = {}
        if (editState.text.length > 0) updates.description = editState.text
        if (editState.owner !== '') updates.owner = editState.owner
        await window.api.itemEditAndConfirm({
          kind: 'action',
          id: editState.id,
          updates,
        })
        useAppStore.setState((state) => ({
          confirmedActions: state.confirmedActions.map((a) =>
            a.id === editState.id
              ? {
                  ...a,
                  description: editState.text.length > 0 ? editState.text : a.description,
                  owner: editState.owner !== '' ? editState.owner : a.owner,
                }
              : a,
          ),
        }))
        confirmItem('action', editState.id)
      }
    } catch (err) {
      console.error('[ReviewScreen] editAndConfirm failed:', err)
    } finally {
      setEditState(null)
    }
  }, [editState, confirmItem])

  const handleEditCancel = useCallback(() => {
    setEditState(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Export helpers (item 0022)
  // ---------------------------------------------------------------------------

  const buildExportInput = useCallback(() => {
    return {
      title: meetingTitle || 'Vergadering',
      agendaItems,
      participants,
      decisions: confirmedDecisions,
      actions: confirmedActions,
      summaries: discussionSummaries,
    }
  }, [
    meetingTitle,
    agendaItems,
    participants,
    confirmedDecisions,
    confirmedActions,
    discussionSummaries,
  ])

  const handleExportMarkdown = useCallback(async () => {
    try {
      const content = toMarkdown(buildExportInput())
      await window.api.exportMarkdown({ content })
    } catch (err) {
      console.error('[ReviewScreen] exportMarkdown failed:', err)
    }
  }, [buildExportInput])

  const handleExportJson = useCallback(async () => {
    try {
      const content = toJson(buildExportInput())
      await window.api.exportJson({ content })
    } catch (err) {
      console.error('[ReviewScreen] exportJson failed:', err)
    }
  }, [buildExportInput])

  const handleCopyMarkdown = useCallback(async () => {
    try {
      const content = toMarkdown(buildExportInput())
      await window.api.exportCopyMarkdown({ content })
      setCopyFeedback(true)
      setTimeout(() => {
        setCopyFeedback(false)
      }, 2000)
    } catch (err) {
      console.error('[ReviewScreen] exportCopyMarkdown failed:', err)
    }
  }, [buildExportInput])

  const hasSummaries = discussionSummaries.length > 0

  // Header title + metadata (date · N deelnemers), with graceful fallbacks.
  const headerTitle =
    meetingTitle.length > 0
      ? `${t('review.title.prefix')} — ${meetingTitle}`
      : t('screen.review.title')

  const metaParts: string[] = []
  if (meetingCreatedAt !== null) {
    metaParts.push(
      new Date(meetingCreatedAt).toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    )
  }
  if (participants.length > 0) {
    const word =
      participants.length === 1 ? t('review.meta.participant') : t('review.meta.participants')
    metaParts.push(`${String(participants.length)} ${word}`)
  }
  const metaLine = metaParts.join(' · ')

  return (
    <main data-testid="screen-review" className="screen screen--review">
      <header className="screen__header">
        <h1 className="screen__title">
          {headerTitle}
          {meetingSource === 'import' && (
            <span className="review-imported-badge" data-testid="review-imported-badge">
              {t('review.imported.badge')}
            </span>
          )}
        </h1>
        <p className="screen__subtitle">
          {metaLine.length > 0 ? metaLine : t('screen.review.subtitle')}
        </p>
      </header>

      {!hasSummaries && (
        <p className="review-no-summaries" data-testid="review-no-summaries">
          {t('review.summary.empty')}
        </p>
      )}

      <div className="review-groups">
        {allGroups.map((group) => {
          const summary = discussionSummaries.find((s) => s.agendaItemId === group.id)
          const groupDecisions = confirmedDecisions.filter((d) => d.agendaItemId === group.id)
          const groupActions = confirmedActions.filter((a) => a.agendaItemId === group.id)

          return (
            <ReviewGroup
              key={group.id}
              agendaId={group.id}
              agendaTitle={group.title}
              summary={summary}
              decisions={groupDecisions}
              actions={groupActions}
              participantMap={participantMap}
              participants={participants}
              editState={editState}
              onEdit={handleEdit}
              onEditChange={handleEditChange}
              onEditSave={() => {
                void handleEditSave()
              }}
              onEditCancel={handleEditCancel}
            />
          )
        })}
      </div>

      <footer className="review-export-actions" data-testid="review-export-actions">
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="review-export-markdown-btn"
          onClick={() => {
            void handleExportMarkdown()
          }}
        >
          {t('review.export.markdown')}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="review-export-json-btn"
          onClick={() => {
            void handleExportJson()
          }}
        >
          {t('review.export.json')}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="review-export-copy-btn"
          onClick={() => {
            void handleCopyMarkdown()
          }}
        >
          {copyFeedback ? t('review.export.copied') : t('review.export.copy')}
        </button>
      </footer>
    </main>
  )
}
