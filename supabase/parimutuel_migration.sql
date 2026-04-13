-- ============================================================
-- LAKSH — Parimutuel Pool Migration
--
-- Replaces formula-based settlement (shares × settlement_price,
-- which can create money from thin air) with a fixed-pool
-- proportional distribution model.
--
-- Model:
--   1. Every user deposit → pool grows, platform takes rake upfront.
--   2. At season end, distribution_pool is divided proportionally
--      based on each user's total portfolio mark-to-market value.
--   3. Mid-season withdrawal → NAV redemption at a 3% exit fee
--      that stays in the pool (benefits remaining participants).
--
-- Run this AFTER schema.sql and all previous migrations.
-- ============================================================

-- ── Season Pool ───────────────────────────────────────────────────────────────
-- One row per season. Tracks the total money pot.
CREATE TABLE IF NOT EXISTS season_pool (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_key         TEXT        NOT NULL UNIQUE,  -- e.g. '2025-26'
  total_deposited    NUMERIC     NOT NULL DEFAULT 0, -- gross sum of all user deposits
  rake_collected     NUMERIC     NOT NULL DEFAULT 0, -- platform revenue from rake
  early_exit_fees    NUMERIC     NOT NULL DEFAULT 0, -- fees collected from mid-season exits (stays in pool)
  distribution_pool  NUMERIC     NOT NULL DEFAULT 0, -- what gets paid out: deposits × (1−rake) + exit fees
  total_withdrawn    NUMERIC     NOT NULL DEFAULT 0, -- cumulative mid-season NAV withdrawals
  settled            BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the current season row so it always exists.
INSERT INTO season_pool (season_key, total_deposited, rake_collected, distribution_pool)
VALUES ('2025-26', 0, 0, 0)
ON CONFLICT (season_key) DO NOTHING;

-- ── User Deposits ─────────────────────────────────────────────────────────────
-- Audit trail: every deposit, withdrawal, and settlement credit.
CREATE TABLE IF NOT EXISTS user_deposits (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_key   TEXT        NOT NULL DEFAULT '2025-26',
  type         TEXT        NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'settlement')),
  gross_amount NUMERIC     NOT NULL,              -- dollars in (deposit) or dollars out (withdrawal/settlement)
  fee_charged  NUMERIC     NOT NULL DEFAULT 0,   -- rake (deposit) or exit fee (withdrawal)
  net_to_pool  NUMERIC     NOT NULL,             -- actual change to distribution_pool
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_deposits_user   ON user_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_user_deposits_season ON user_deposits(season_key);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE season_pool   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_deposits ENABLE ROW LEVEL SECURITY;

-- Anyone can read pool stats (transparency)
DO $$ BEGIN
  CREATE POLICY "Anyone can read season pool"
    ON season_pool FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can only read their own deposit history
DO $$ BEGIN
  CREATE POLICY "Users can read own deposits"
    ON user_deposits FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role (backend) can do everything
DO $$ BEGIN
  CREATE POLICY "Service role full access on season_pool"
    ON season_pool USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access on user_deposits"
    ON user_deposits USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Pool deposit helper function ──────────────────────────────────────────────
-- Called transactionally: records the deposit, charges rake, updates pool total.
-- Returns the net amount added to the distribution pool.
CREATE OR REPLACE FUNCTION record_pool_deposit(
  p_user_id    UUID,
  p_gross      NUMERIC,
  p_rake_rate  NUMERIC,  -- e.g. 0.05 for 5%
  p_season_key TEXT DEFAULT '2025-26'
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rake   NUMERIC;
  v_net    NUMERIC;
BEGIN
  v_rake := ROUND(p_gross * p_rake_rate, 2);
  v_net  := p_gross - v_rake;

  INSERT INTO user_deposits
    (user_id, season_key, type, gross_amount, fee_charged, net_to_pool, note)
  VALUES
    (p_user_id, p_season_key, 'deposit', p_gross, v_rake, v_net, 'Season entry deposit');

  UPDATE season_pool SET
    total_deposited   = total_deposited   + p_gross,
    rake_collected    = rake_collected    + v_rake,
    distribution_pool = distribution_pool + v_net,
    updated_at        = NOW()
  WHERE season_key = p_season_key;

  RETURN v_net;
END;
$$;

-- ── Back-fill: register existing users into the pool ─────────────────────────
-- Users who signed up before this migration are already in the users table
-- with their $10k balance but have no entry in season_pool or user_deposits.
-- This DO block back-fills them atomically: one deposit record per user,
-- pool totals updated in bulk.
DO $$
DECLARE
  r          RECORD;
  v_rake     NUMERIC;
  v_net      NUMERIC;
  v_rake_rate NUMERIC := 0.05;
  v_season   TEXT    := '2025-26';
BEGIN
  FOR r IN
    SELECT id, initial_balance
    FROM users
    WHERE NOT EXISTS (
      SELECT 1 FROM user_deposits
      WHERE user_deposits.user_id = users.id
        AND user_deposits.season_key = v_season
        AND user_deposits.type = 'deposit'
    )
  LOOP
    v_rake := ROUND(r.initial_balance * v_rake_rate, 2);
    v_net  := r.initial_balance - v_rake;

    INSERT INTO user_deposits
      (user_id, season_key, type, gross_amount, fee_charged, net_to_pool, note)
    VALUES
      (r.id, v_season, 'deposit', r.initial_balance, v_rake, v_net, 'Back-filled from existing account');

    UPDATE season_pool SET
      total_deposited   = total_deposited   + r.initial_balance,
      rake_collected    = rake_collected    + v_rake,
      distribution_pool = distribution_pool + v_net,
      updated_at        = NOW()
    WHERE season_key = v_season;
  END LOOP;
END $$;

-- ── Pool withdrawal helper function ───────────────────────────────────────────
-- Records a mid-season NAV withdrawal. Exit fee stays in the pool.
CREATE OR REPLACE FUNCTION record_pool_withdrawal(
  p_user_id    UUID,
  p_nav        NUMERIC,    -- user's total portfolio mark-to-market value
  p_exit_rate  NUMERIC,    -- e.g. 0.03 for 3%
  p_season_key TEXT DEFAULT '2025-26'
)
RETURNS NUMERIC  -- returns amount paid out to user
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fee     NUMERIC;
  v_payout  NUMERIC;
BEGIN
  v_fee    := ROUND(p_nav * p_exit_rate, 2);
  v_payout := p_nav - v_fee;

  INSERT INTO user_deposits
    (user_id, season_key, type, gross_amount, fee_charged, net_to_pool, note)
  VALUES
    (p_user_id, p_season_key, 'withdrawal', p_nav, v_fee, -v_payout,
     'Mid-season NAV withdrawal (3% exit fee retained in pool)');

  UPDATE season_pool SET
    total_withdrawn   = total_withdrawn   + v_payout,
    early_exit_fees   = early_exit_fees   + v_fee,
    -- Exit fee STAYS in pool (helps remaining participants)
    -- distribution_pool shrinks only by the payout, not the full NAV
    distribution_pool = distribution_pool - v_payout,
    updated_at        = NOW()
  WHERE season_key = p_season_key;

  RETURN v_payout;
END;
$$;
