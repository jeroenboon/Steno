-- Migration 0002: Meeting lifecycle fields
-- Adds paused flag (sub-state within Live) and started_at timestamp.
-- paused is 0 (false) or 1 (true); only meaningful when state = 'live'.
-- started_at records when Draft → Live transition occurred.

ALTER TABLE meetings ADD COLUMN paused    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN started_at TEXT;   -- ISO 8601, nullable
