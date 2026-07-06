/**
 * Item-action IPC handlers (audit A2b): item:confirm/editAndConfirm/dismiss/
 * createConfirmed (item 0018). Owns the ItemOps port, satisfied by
 * ItemLifecycleService.
 */

import {
  ItemConfirmRequestSchema,
  ItemEditAndConfirmRequestSchema,
  ItemDismissRequestSchema,
  ItemDismissResponseSchema,
  ItemCreateConfirmedRequestSchema,
} from '@shared/ipc'
import type {
  IpcChannel,
  ItemConfirmResponse,
  ItemEditAndConfirmResponse,
  ItemDismissResponse,
  ItemCreateConfirmedResponse,
} from '@shared/ipc'

import type { ItemLifecycleService } from '../services/itemLifecycleService'

import type { Handler } from './handlerTypes'

/**
 * Proposed/Confirmed item lifecycle. Satisfied by ItemLifecycleService. Picked
 * from the class so the port can never drift from the methods the handlers call.
 */
export type ItemOps = Pick<
  ItemLifecycleService,
  | 'confirm'
  | 'editAndConfirmDecision'
  | 'editAndConfirmAction'
  | 'dismiss'
  | 'createConfirmedDecision'
  | 'createConfirmedAction'
>

export interface ItemHandlerDeps {
  items?: ItemOps
}

export function createItemHandlers(deps: ItemHandlerDeps): Partial<Record<IpcChannel, Handler>> {
  return {
    'item:confirm': (raw: unknown): ItemConfirmResponse => {
      const req = ItemConfirmRequestSchema.parse(raw)
      if (deps.items === undefined) {
        throw new Error('ItemLifecycleService is not available')
      }
      return deps.items.confirm({ kind: req.kind, id: req.id })
    },
    'item:editAndConfirm': (raw: unknown): ItemEditAndConfirmResponse => {
      const req = ItemEditAndConfirmRequestSchema.parse(raw)
      if (deps.items === undefined) {
        throw new Error('ItemLifecycleService is not available')
      }
      if (req.kind === 'decision') {
        // Rebuild with only defined keys: under exactOptionalPropertyTypes a
        // value of `string | undefined` is not assignable to an optional `string`.
        const updates: Parameters<typeof deps.items.editAndConfirmDecision>[1] = {}
        if (req.updates.rationale !== undefined) updates.rationale = req.updates.rationale
        if (req.updates.agendaItemId !== undefined) updates.agendaItemId = req.updates.agendaItemId
        return deps.items.editAndConfirmDecision(req.id, updates)
      } else {
        const updates: Parameters<typeof deps.items.editAndConfirmAction>[1] = {}
        if (req.updates.status !== undefined) updates.status = req.updates.status
        if (req.updates.agendaItemId !== undefined) updates.agendaItemId = req.updates.agendaItemId
        if (req.updates.owner !== undefined) updates.owner = req.updates.owner
        if (req.updates.dueDate !== undefined) updates.dueDate = req.updates.dueDate
        return deps.items.editAndConfirmAction(req.id, updates)
      }
    },
    'item:dismiss': (raw: unknown): ItemDismissResponse => {
      const req = ItemDismissRequestSchema.parse(raw)
      if (deps.items === undefined) {
        throw new Error('ItemLifecycleService is not available')
      }
      deps.items.dismiss({ kind: req.kind, id: req.id })
      return ItemDismissResponseSchema.parse({ ok: true })
    },
    'item:createConfirmed': (raw: unknown): ItemCreateConfirmedResponse => {
      const req = ItemCreateConfirmedRequestSchema.parse(raw)
      if (deps.items === undefined) {
        throw new Error('ItemLifecycleService is not available')
      }
      if (req.kind === 'decision') {
        return deps.items.createConfirmedDecision(req.meetingId, req.item)
      } else {
        return deps.items.createConfirmedAction(req.meetingId, req.item)
      }
    },
  }
}
