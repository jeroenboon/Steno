import type Database from 'better-sqlite3'

import { DecisionSchema } from '@shared/domain'
import type { Decision } from '@shared/domain'

interface DecisionRow {
  id: string
  meeting_id: string
  rationale: string
  agenda_item_id: string
  source_span_id: string
  state: string
}

function rowToDomain(row: DecisionRow): Decision {
  return DecisionSchema.parse({
    id: row.id,
    rationale: row.rationale,
    agendaItemId: row.agenda_item_id,
    sourceSpanId: row.source_span_id,
    state: row.state,
  })
}

export function decisionRepo(db: Database.Database) {
  return {
    insert(d: Decision, meetingId: string): void {
      db.prepare(
        `INSERT INTO decisions (id, meeting_id, rationale, agenda_item_id, source_span_id, state)
         VALUES (@id, @meetingId, @rationale, @agendaItemId, @sourceSpanId, @state)`,
      ).run({
        id: d.id,
        meetingId,
        rationale: d.rationale,
        agendaItemId: d.agendaItemId,
        sourceSpanId: d.sourceSpanId,
        state: d.state,
      })
    },

    update(d: Decision): void {
      db.prepare(
        `UPDATE decisions
         SET rationale = @rationale, agenda_item_id = @agendaItemId,
             source_span_id = @sourceSpanId, state = @state
         WHERE id = @id`,
      ).run({
        id: d.id,
        rationale: d.rationale,
        agendaItemId: d.agendaItemId,
        sourceSpanId: d.sourceSpanId,
        state: d.state,
      })
    },

    findById(id: string): Decision | null {
      const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
        | DecisionRow
        | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    listByMeeting(meetingId: string): Decision[] {
      const rows = db
        .prepare('SELECT * FROM decisions WHERE meeting_id = ?')
        .all(meetingId) as DecisionRow[]
      return rows.map(rowToDomain)
    },

    /** Resolve the meeting a decision belongs to, or null when unknown. */
    findMeetingId(id: string): string | null {
      const row = db.prepare('SELECT meeting_id FROM decisions WHERE id = ?').get(id) as
        | { meeting_id: string }
        | undefined
      return row?.meeting_id ?? null
    },

    delete(id: string): void {
      db.prepare('DELETE FROM decisions WHERE id = ?').run(id)
    },
  }
}
