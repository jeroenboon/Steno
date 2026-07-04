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
import { toMarkdown } from '@shared/export/meetingExporter'

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
  /**
   * When set, the item is Proposed: render Confirm + Dismiss controls instead of
   * the Edit button. The note-taker grooms the final pass's output here (an Ended
   * meeting stays fully editable). Confirmed items keep the Edit affordance.
   */
  onConfirm?: (kind: ItemKind, id: string) => void
  onDismiss?: (kind: ItemKind, id: string) => void
}

function ReviewItemCard({
  id,
  kind,
  text,
  ownerName,
  onEdit,
  onConfirm,
  onDismiss,
}: ReviewItemCardProps): React.JSX.Element {
  const proposed = onConfirm !== undefined && onDismiss !== undefined

  return (
    <div
      className={`review-item-card review-item-card--${kind}${proposed ? ' review-item-card--proposed' : ''}`}
      data-testid={`review-${kind}-${id}`}
    >
      <p className="review-item-card__text">{text}</p>
      {ownerName !== undefined && (
        <p className="review-item-card__owner">
          <span className="review-item-card__owner-label">{t('review.items.owner')}: </span>
          {ownerName}
        </p>
      )}
      <div className="review-item-card__actions">
        {proposed ? (
          <>
            <button
              type="button"
              className="btn review-item-card__confirm"
              data-testid={`review-confirm-${kind}-${id}`}
              onClick={() => {
                onConfirm(kind, id)
              }}
            >
              {t('review.items.confirm')}
            </button>
            <button
              type="button"
              className="btn btn--secondary review-item-card__dismiss"
              data-testid={`review-dismiss-${kind}-${id}`}
              onClick={() => {
                onDismiss(kind, id)
              }}
            >
              {t('review.items.dismiss')}
            </button>
          </>
        ) : (
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
        )}
      </div>
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
  proposedDecisions: ProposedDecision[]
  proposedActions: ProposedAction[]
  participantMap: Map<string, string>
  participants: { id: string; name: string }[]
  editState: EditState | null
  onEdit: (kind: ItemKind, id: string, text: string, owner: string) => void
  onConfirm: (kind: ItemKind, id: string) => void
  onDismiss: (kind: ItemKind, id: string) => void
  onEditChange: (field: 'text' | 'owner', value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
}

function actionText(a: ProposedAction): string {
  return a.description !== undefined && a.description.length > 0
    ? a.description
    : t('live.items.action.untitled')
}

function actionOwnerName(
  a: ProposedAction,
  participantMap: Map<string, string>,
): string | undefined {
  return a.owner !== undefined ? (participantMap.get(a.owner) ?? a.owner) : undefined
}

function ReviewGroup({
  agendaId,
  agendaTitle,
  summary,
  decisions,
  actions,
  proposedDecisions,
  proposedActions,
  participantMap,
  participants,
  editState,
  onEdit,
  onConfirm,
  onDismiss,
  onEditChange,
  onEditSave,
  onEditCancel,
}: ReviewGroupProps): React.JSX.Element {
  const hasItems =
    decisions.length > 0 ||
    actions.length > 0 ||
    proposedDecisions.length > 0 ||
    proposedActions.length > 0

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

      {(proposedDecisions.length > 0 || decisions.length > 0) && (
        <div className="review-items-section">
          <h3 className="review-items-section__heading">{t('review.items.decisions.heading')}</h3>
          {proposedDecisions.map((d) => (
            <ReviewItemCard
              key={d.id}
              id={d.id}
              kind="decision"
              text={d.rationale}
              ownerName={undefined}
              onEdit={onEdit}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
            />
          ))}
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

      {(proposedActions.length > 0 || actions.length > 0) && (
        <div className="review-items-section">
          <h3 className="review-items-section__heading">{t('review.items.actions.heading')}</h3>
          {proposedActions.map((a) => (
            <ReviewItemCard
              key={a.id}
              id={a.id}
              kind="action"
              text={actionText(a)}
              ownerName={actionOwnerName(a, participantMap)}
              onEdit={onEdit}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
            />
          ))}
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
                  text={actionText(a)}
                  ownerName={actionOwnerName(a, participantMap)}
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
  const proposedDecisions = useAppStore((s) => s.proposedDecisions)
  const proposedActions = useAppStore((s) => s.proposedActions)
  const discussionSummaries = useAppStore((s) => s.discussionSummaries)
  const confirmItem = useAppStore((s) => s.confirmItem)
  const removeProposedItem = useAppStore((s) => s.removeProposedItem)
  const meetingTitle = useAppStore((s) => s.meetingTitle)
  const meetingCreatedAt = useAppStore((s) => s.meetingCreatedAt)
  const meetingSource = useAppStore((s) => s.meetingSource)
  const activeMeeting = useAppStore((s) => s.activeMeeting)

  const [editState, setEditState] = useState<EditState | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [transcriptCopyFeedback, setTranscriptCopyFeedback] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'saving' | 'saved'>('idle')

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

  // Confirm / dismiss a Proposed item straight from Review (an Ended meeting is
  // still groomable). Persist through IPC, then reflect it in the store.
  const handleConfirm = useCallback(
    async (kind: ItemKind, id: string) => {
      try {
        await window.api.itemConfirm({ kind, id })
        confirmItem(kind, id)
      } catch (err) {
        console.error('[ReviewScreen] itemConfirm failed:', err)
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
        console.error('[ReviewScreen] itemDismiss failed:', err)
      }
    },
    [removeProposedItem],
  )

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
    // The native save dialog can take a moment to appear on Windows; show a
    // 'saving' state so the UI never looks frozen (item 0022 follow-up).
    setExportState('saving')
    try {
      const content = toMarkdown(buildExportInput())
      const result = await window.api.exportMarkdown({ content })
      if (result.ok) {
        setExportState('saved')
        setTimeout(() => {
          setExportState('idle')
        }, 2000)
      } else {
        // Cancelled or failed: return to idle without a success flash.
        setExportState('idle')
      }
    } catch (err) {
      console.error('[ReviewScreen] exportMarkdown failed:', err)
      setExportState('idle')
    }
  }, [buildExportInput])

  const handleCopyTranscript = useCallback(async () => {
    if (activeMeeting === null) return
    try {
      await window.api.transcriptCopy({ meetingId: activeMeeting })
      setTranscriptCopyFeedback(true)
      setTimeout(() => {
        setTranscriptCopyFeedback(false)
      }, 2000)
    } catch (err) {
      console.error('[ReviewScreen] transcriptCopy failed:', err)
    }
  }, [activeMeeting])

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
          const groupProposedDecisions = proposedDecisions.filter(
            (d) => d.agendaItemId === group.id,
          )
          const groupProposedActions = proposedActions.filter((a) => a.agendaItemId === group.id)

          return (
            <ReviewGroup
              key={group.id}
              agendaId={group.id}
              agendaTitle={group.title}
              summary={summary}
              decisions={groupDecisions}
              actions={groupActions}
              proposedDecisions={groupProposedDecisions}
              proposedActions={groupProposedActions}
              participantMap={participantMap}
              participants={participants}
              editState={editState}
              onEdit={handleEdit}
              onConfirm={(kind, id) => void handleConfirm(kind, id)}
              onDismiss={(kind, id) => void handleDismiss(kind, id)}
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
          disabled={exportState === 'saving'}
          aria-busy={exportState === 'saving'}
          onClick={() => {
            void handleExportMarkdown()
          }}
        >
          {exportState === 'saving'
            ? t('review.export.saving')
            : exportState === 'saved'
              ? t('review.export.saved')
              : t('review.export.markdown')}
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
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="review-copy-transcript-btn"
          disabled={activeMeeting === null}
          onClick={() => {
            void handleCopyTranscript()
          }}
        >
          {transcriptCopyFeedback ? t('review.transcript.copied') : t('review.transcript.copy')}
        </button>
      </footer>
    </main>
  )
}
