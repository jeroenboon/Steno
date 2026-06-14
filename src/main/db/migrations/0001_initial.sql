-- Migration 0001: Initial schema
-- All tables for the LiveTranscriber domain.
-- Cross-meeting queries are supported: owner, due_date, status are real columns.

CREATE TABLE IF NOT EXISTS meetings (
  id              TEXT PRIMARY KEY NOT NULL,
  title           TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('draft', 'live', 'ended')),
  created_at      TEXT NOT NULL,  -- ISO 8601
  updated_at      TEXT,           -- ISO 8601, nullable
  ended_at        TEXT,           -- ISO 8601, nullable
  primary_language TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agenda_items (
  id          TEXT PRIMARY KEY NOT NULL,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  topic       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY NOT NULL,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_spans (
  id            TEXT PRIMARY KEY NOT NULL,
  meeting_id    TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  start_ms      REAL NOT NULL,
  end_ms        REAL NOT NULL,
  confidence    REAL,           -- nullable: not all providers return this
  speaker_label TEXT            -- nullable: only when diarization is on
);

CREATE TABLE IF NOT EXISTS decisions (
  id             TEXT PRIMARY KEY NOT NULL,
  meeting_id     TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  rationale      TEXT NOT NULL,
  agenda_item_id TEXT NOT NULL,  -- FK to agenda_items.id OR '__off-agenda__'
  source_span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE RESTRICT,
  state          TEXT NOT NULL CHECK (state IN ('proposed', 'confirmed'))
);

CREATE TABLE IF NOT EXISTS actions (
  id             TEXT PRIMARY KEY NOT NULL,
  meeting_id     TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  agenda_item_id TEXT NOT NULL,  -- FK to agenda_items.id OR '__off-agenda__'
  source_span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE RESTRICT,
  owner          TEXT,           -- nullable ParticipantId
  due_date       TEXT,           -- ISO 8601, nullable
  status         TEXT NOT NULL CHECK (status IN ('open', 'done')),
  state          TEXT NOT NULL CHECK (state IN ('proposed', 'confirmed'))
);

-- Index for cross-meeting queries: open actions by owner
CREATE INDEX IF NOT EXISTS idx_actions_owner_status ON actions(owner, status);

CREATE TABLE IF NOT EXISTS discussion_summaries (
  id             TEXT PRIMARY KEY NOT NULL,
  meeting_id     TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  agenda_item_id TEXT NOT NULL,
  text           TEXT NOT NULL
);
