-- Migration 0004: Recording source (item 0026)
-- Records where a Meeting's Transcript came from: 'live' capture or 'import'
-- from an uploaded audio file. NOT NULL with DEFAULT 'live' so every existing
-- row (all captured live) gets the correct value without a backfill.

ALTER TABLE meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'live';
