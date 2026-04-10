-- ============================================================
-- LAKSH — Pricing Engine v2 Migration
-- Safe to run on existing DB (all steps use IF NOT EXISTS / IF EXISTS).
-- ============================================================

-- ── 1. New columns on players ─────────────────────────────────────────────────

-- TWAP: 5-minute time-weighted average price (manipulation-resistant reference)
ALTER TABLE players ADD COLUMN IF NOT EXISTS twap_price DECIMAL(10,2) DEFAULT NULL;

-- Fair value computed by oracle each tick (Bayesian-shrunk stat projection)
ALTER TABLE players ADD COLUMN IF NOT EXISTS fair_value DECIMAL(10,2) DEFAULT NULL;

-- Virtual market depth in USD — higher = harder to manipulate
ALTER TABLE players ADD COLUMN IF NOT EXISTS market_depth DECIMAL(14,2) NOT NULL DEFAULT 40000;

-- Price blend weights stored for observability / debugging
ALTER TABLE players ADD COLUMN IF NOT EXISTS blend_w_amm  DECIMAL(6,4) NOT NULL DEFAULT 0.40;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blend_w_fv   DECIMAL(6,4) NOT NULL DEFAULT 0.40;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blend_w_twap DECIMAL(6,4) NOT NULL DEFAULT 0.20;

-- Timestamp of last completed trade (used for idle-decay weight calculation)
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMPTZ DEFAULT NULL;

-- Rolling 24h trade volume in USD (used for depth and weight calculations)
ALTER TABLE players ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Live game boost fields (from live-stats.ts, already added by prior migration —
-- included here as IF NOT EXISTS for idempotency)
ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_boost       DECIMAL(6,4)  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS live_boost_expires_at TIMESTAMPTZ   DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS live_stats_snapshot   JSONB         DEFAULT NULL;


-- ── 2. trade_pressure table ───────────────────────────────────────────────────
-- Tracks each user's net directional pressure per player over a rolling window.
-- Used by the anti-manipulation layer to penalise sustained one-sided trading.

CREATE TABLE IF NOT EXISTS trade_pressure (
  user_id          UUID         NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  player_id        UUID         NOT NULL REFERENCES players(id)     ON DELETE CASCADE,
  net_buy_dollars  DECIMAL(14,2) NOT NULL DEFAULT 0,
  window_start     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, player_id)
);

CREATE INDEX IF NOT EXISTS trade_pressure_updated_at_idx ON trade_pressure (updated_at);


-- ── 3. Seed new columns from existing data ────────────────────────────────────

-- Initialise fair_value from existing expected_final_value where available
UPDATE players
SET fair_value = expected_final_value
WHERE fair_value IS NULL AND expected_final_value IS NOT NULL;

-- Initialise twap_price to current_price as starting point
UPDATE players
SET twap_price = current_price
WHERE twap_price IS NULL;

-- Seed market_depth based on approximate season progress at time of migration
-- (will be recomputed on first tick anyway)
UPDATE players
SET market_depth = 50000
WHERE market_depth = 40000;


-- ── 4. Add volume_24h update to existing trades (optional backfill) ──────────
-- This just ensures the column is present and consistent; actual values
-- will be computed fresh by the tick route on next run.

-- ── 5. RLS policies for trade_pressure ───────────────────────────────────────
-- Users can read their own pressure but only the server can write.
ALTER TABLE trade_pressure ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view own pressure"
  ON trade_pressure FOR SELECT
  USING (auth.uid() = user_id);

-- Service role bypasses RLS automatically in server-side code (serverSupa uses service key).
