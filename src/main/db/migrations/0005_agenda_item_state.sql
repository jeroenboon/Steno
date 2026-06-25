-- Migration 0005: Agenda item lifecycle state (live agenda inference, ADR 0029)
-- Gives AgendaItem the same Proposed/Confirmed lifecycle as Decisions and
-- Actions. NOT NULL with DEFAULT 'confirmed' so every existing row (all
-- user-entered) gets the correct value without a backfill; agent-inferred
-- items are inserted as 'proposed'.

ALTER TABLE agenda_items ADD COLUMN state TEXT NOT NULL DEFAULT 'confirmed';
