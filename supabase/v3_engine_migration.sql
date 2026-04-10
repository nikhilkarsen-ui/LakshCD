-- ============================================================
-- LAKSH — Pricing Engine v3 Migration
-- ============================================================

-- ── 1. Players: new v3 columns ────────────────────────────────────────────────

-- Player-specific prior FV score (0–1). Seeded from prior season stats.
-- Falls back to league average (0.45) if null.
-- Prevents the early-season systematic mispricing from v2.
ALTER TABLE players ADD COLUMN IF NOT EXISTS prior_fv_score DECIMAL(6,4) DEFAULT NULL;

-- Momentum circuit breaker flag: set true by the tick when breaker triggers.
-- Trading engine reads this to block buys.
ALTER TABLE players ADD COLUMN IF NOT EXISTS momentum_breaker_active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS momentum_breaker_until   TIMESTAMPTZ DEFAULT NULL;

-- 30-minute TWAP (v3 default) — separate from 5-min twap_price
ALTER TABLE players ADD COLUMN IF NOT EXISTS twap_30m DECIMAL(10,2) DEFAULT NULL;

-- Dynamic fee rate last applied (for observability)
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.002;

-- Columns added by v2 migration (idempotent re-adds)
ALTER TABLE players ADD COLUMN IF NOT EXISTS twap_price             DECIMAL(10,2)  DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS fair_value             DECIMAL(10,2)  DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS market_depth           DECIMAL(14,2)  NOT NULL DEFAULT 80000;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blend_w_amm            DECIMAL(6,4)   NOT NULL DEFAULT 0.15;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blend_w_fv             DECIMAL(6,4)   NOT NULL DEFAULT 0.65;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blend_w_twap           DECIMAL(6,4)   NOT NULL DEFAULT 0.20;
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_trade_at          TIMESTAMPTZ    DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS volume_24h             DECIMAL(14,2)  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS live_game_boost        DECIMAL(6,4)   NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS live_boost_expires_at  TIMESTAMPTZ    DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS live_stats_snapshot    JSONB          DEFAULT NULL;


-- ── 2. trade_pressure table ───────────────────────────────────────────────────
-- Idempotent re-create (v2 migration may already have this)
CREATE TABLE IF NOT EXISTS trade_pressure (
  user_id          UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id        UUID          NOT NULL REFERENCES players(id)    ON DELETE CASCADE,
  net_buy_dollars  DECIMAL(14,2) NOT NULL DEFAULT 0,
  window_start     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, player_id)
);
CREATE INDEX IF NOT EXISTS trade_pressure_updated_at_idx ON trade_pressure (updated_at);


-- ── 3. Seed prior_fv_score from existing data ────────────────────────────────
-- Map current expected_value (EV score 0–1000) to normalised 0–1 score.
-- This gives each player a player-specific Bayesian prior for next season.
UPDATE players
SET prior_fv_score = LEAST(1.0, GREATEST(0.0, ROUND(CAST(expected_value AS NUMERIC) / 1000, 4)))
WHERE prior_fv_score IS NULL
  AND expected_value IS NOT NULL
  AND expected_value > 0;

-- Players with no EV data get league average
UPDATE players
SET prior_fv_score = 0.45
WHERE prior_fv_score IS NULL;


-- ── 4. Seed v3 columns from v2 data ──────────────────────────────────────────
UPDATE players SET fair_value    = expected_final_value WHERE fair_value  IS NULL;
UPDATE players SET twap_price    = current_price        WHERE twap_price  IS NULL;
UPDATE players SET twap_30m      = current_price        WHERE twap_30m    IS NULL;
UPDATE players SET market_depth  = 80000                WHERE market_depth < 80000;
UPDATE players SET blend_w_amm   = 0.15                 WHERE blend_w_amm  = 0.40;
UPDATE players SET blend_w_fv    = 0.65                 WHERE blend_w_fv   = 0.40;


-- ── 5. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE trade_pressure ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own pressure"
    ON trade_pressure FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
