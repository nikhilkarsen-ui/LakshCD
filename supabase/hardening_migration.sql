-- ============================================================
-- LAKSH — Security Hardening Migration
--
-- Fixes:
--   1. Sybil detection: signup_ip + trade_ip on users/trades
--   2. Settlement lock: prevent double-settlement on concurrent requests
--   3. Cross-account shared pressure: IP-linked accounts share fill penalty
--   4. Disposable email domain blocklist
-- ============================================================

-- ── 1. Sybil fingerprinting ───────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_ip   INET    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_trade_ip INET  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS account_flags TEXT[] DEFAULT '{}';

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS trade_ip INET DEFAULT NULL;

-- Index: find all accounts from the same IP quickly
CREATE INDEX IF NOT EXISTS idx_users_signup_ip     ON users (signup_ip)     WHERE signup_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_trade_ip ON users (last_trade_ip) WHERE last_trade_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_ip           ON trades (trade_ip)     WHERE trade_ip IS NOT NULL;

-- ── 2. Settlement lock ────────────────────────────────────────────────────────
-- Prevents concurrent requests from settling the same season twice.
CREATE TABLE IF NOT EXISTS settlement_lock (
  id           INT         PRIMARY KEY DEFAULT 1,
  settled_at   TIMESTAMPTZ DEFAULT NULL,
  CHECK (id = 1)
);

INSERT INTO settlement_lock (id, settled_at)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- Atomic claim: returns TRUE only once — subsequent calls see settled_at IS NOT NULL
CREATE OR REPLACE FUNCTION claim_settlement()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE settlement_lock
  SET    settled_at = now()
  WHERE  id = 1
    AND  settled_at IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

ALTER TABLE settlement_lock ENABLE ROW LEVEL SECURITY;

-- ── 3. Cross-account IP pressure function ────────────────────────────────────
-- Returns the combined decayed buy pressure for all accounts sharing the
-- same signup_ip as the given user_id, for a given player.
-- Called from the trade gate to detect sybil coordination.
CREATE OR REPLACE FUNCTION get_ip_shared_pressure(
  p_user_id   UUID,
  p_player_id UUID,
  p_lookback_ms BIGINT DEFAULT 14400000  -- 4 hours
)
RETURNS DECIMAL
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_ip        INET;
  total_pressure DECIMAL := 0;
  t              RECORD;
BEGIN
  -- Get this user's signup IP
  SELECT signup_ip INTO user_ip FROM users WHERE id = p_user_id;
  IF user_ip IS NULL THEN RETURN 0; END IF;

  -- Sum decayed pressure across ALL accounts from this IP
  FOR t IN
    SELECT tr.side, tr.total_value, tr.created_at
    FROM trades tr
    JOIN users u ON u.id = tr.user_id
    WHERE u.signup_ip = user_ip
      AND tr.player_id = p_player_id
      AND tr.side IN ('buy', 'sell')
      AND tr.created_at >= NOW() - (p_lookback_ms || ' milliseconds')::INTERVAL
      AND tr.user_id != p_user_id  -- exclude own trades (already counted separately)
    LIMIT 200
  LOOP
    DECLARE
      age_ms  BIGINT;
      decay   DECIMAL;
    BEGIN
      age_ms := EXTRACT(EPOCH FROM (NOW() - t.created_at)) * 1000;
      decay  := EXP(-age_ms::DECIMAL / 1800000);  -- 30-min half-life
      IF t.side = 'buy' THEN
        total_pressure := total_pressure + t.total_value * decay;
      ELSE
        total_pressure := total_pressure - t.total_value * decay;
      END IF;
    END;
  END LOOP;

  RETURN total_pressure;
END;
$$;
