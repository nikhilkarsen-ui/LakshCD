-- ============================================================
-- LAKSH — Injury Fields Migration
--
-- Adds injury tracking columns to the players table.
-- Synced from BallDontLie /injuries endpoint daily.
-- ============================================================

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS injury_status      TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS injury_description TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS injury_updated_at  TIMESTAMPTZ DEFAULT NULL;

-- Index for fast filtering of injured players
CREATE INDEX IF NOT EXISTS idx_players_injury_status ON players (injury_status)
  WHERE injury_status IS NOT NULL;
