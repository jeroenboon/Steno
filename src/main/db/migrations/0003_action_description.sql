-- Migration 0003: add a human-readable description to actions.
-- The extraction provider already produces a description per action; this
-- column lets it persist instead of being dropped at the domain boundary.
-- Nullable: existing rows and pre-description manual adds have no description.

ALTER TABLE actions ADD COLUMN description TEXT;
