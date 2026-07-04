import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { parseRow } from './mapRow'

const RowSchema = z.object({
  id: z.string(),
  agendaItemId: z.string(),
  owner: z.string().optional(),
})

describe('parseRow', () => {
  it('maps snake_case columns to camelCase fields', () => {
    const result = parseRow({ id: 'a-1', agenda_item_id: 'ag-1', owner: 'Jeroen' }, RowSchema)

    expect(result).toEqual({ id: 'a-1', agendaItemId: 'ag-1', owner: 'Jeroen' })
  })

  it('turns SQL NULL into undefined for optional fields', () => {
    // Mirrors the old `row.owner ?? undefined`: the field reads as undefined
    // (never the raw null that would fail an optional string schema).
    const result = parseRow({ id: 'a-1', agenda_item_id: 'ag-1', owner: null }, RowSchema)

    expect(result.owner).toBeUndefined()
  })

  it('strips columns the schema does not declare (e.g. the meeting_id FK)', () => {
    const result = parseRow({ id: 'a-1', agenda_item_id: 'ag-1', meeting_id: 'mtg-1' }, RowSchema)

    expect(result).not.toHaveProperty('meetingId')
    expect(result).not.toHaveProperty('meeting_id')
  })

  it('throws when the row does not match the schema', () => {
    expect(() => parseRow({ id: 'a-1' }, RowSchema)).toThrow()
  })
})
