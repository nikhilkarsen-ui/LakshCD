-- ============================================================
-- LAKSH — Live game boost columns
-- Run against your Supabase database to enable live pricing.
-- ============================================================

-- Boost value set by the live-stats sync (-1 to +1).
-- 0 = no game today / neutral.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS live_game_boost       DECIMAL(6,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_boost_expires_at TIMESTAMPTZ   DEFAULT NULL,
  -- JSON snapshot of last-seen box-score stats for this player.
  -- Shape: { game_id, pts, ast, reb, stl, blk, tov, fga, fgm, fta, ftm }
  -- Diffed on each live sync to derive per-event price deltas.
  ADD COLUMN IF NOT EXISTS live_stats_snapshot   JSONB         DEFAULT NULL;
