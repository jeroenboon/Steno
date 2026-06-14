import type Database from 'better-sqlite3'

import { TranscriptSpanSchema } from '@shared/domain'
import type { TranscriptSpan } from '@shared/domain'

interface TranscriptSpanRow {
  id: string
  meeting_id: string
  text: string
  start_ms: number
  end_ms: number
  confidence: number | null
  speaker_label: string | null
}

function rowToDomain(row: TranscriptSpanRow): TranscriptSpan {
  return TranscriptSpanSchema.parse({
    id: row.id,
    text: row.text,
    startMs: row.start_ms,
    endMs: row.end_ms,
    confidence: row.confidence ?? undefined,
    speakerLabel: row.speaker_label ?? undefined,
  })
}

export function transcriptSpanRepo(db: Database.Database) {
  return {
    insert(span: TranscriptSpan, meetingId: string): void {
      db.prepare(
        `INSERT INTO transcript_spans (id, meeting_id, text, start_ms, end_ms, confidence, speaker_label)
         VALUES (@id, @meetingId, @text, @startMs, @endMs, @confidence, @speakerLabel)`,
      ).run({
        id: span.id,
        meetingId,
        text: span.text,
        startMs: span.startMs,
        endMs: span.endMs,
        confidence: span.confidence ?? null,
        speakerLabel: span.speakerLabel ?? null,
      })
    },

    findById(id: string): TranscriptSpan | null {
      const row = db.prepare('SELECT * FROM transcript_spans WHERE id = ?').get(id) as
        | TranscriptSpanRow
        | undefined
      if (row === undefined) return null
      return rowToDomain(row)
    },

    listByMeeting(meetingId: string): TranscriptSpan[] {
      const rows = db
        .prepare('SELECT * FROM transcript_spans WHERE meeting_id = ? ORDER BY start_ms ASC')
        .all(meetingId) as TranscriptSpanRow[]
      return rows.map(rowToDomain)
    },

    delete(id: string): void {
      db.prepare('DELETE FROM transcript_spans WHERE id = ?').run(id)
    },
  }
}
