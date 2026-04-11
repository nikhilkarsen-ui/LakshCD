-- ============================================================
-- LAKSH — Tick Lock Migration
--
-- Prevents concurrent price ticks from racing when many users
-- are connected and all firing /api/prices/tick every 5 seconds.
--
-- The tick route calls claim_tick_slot() which atomically checks
-- whether a tick ran recently. If yes, returns false and the route
-- exits immediately. If no, updates last_ran_at and returns true.
--
-- Result: tick computation runs at most once per min_interval_ms
-- regardless of how many concurrent callers there are.
-- ============================================================

-- ── 1. Single-row lock table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tick_lock (
  id          INT         PRIMARY KEY DEFAULT 1,           -- always exactly one row
  last_ran_at TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01',   -- epoch sentinel on first run
  CHECK (id = 1)
);

-- Seed the single row
INSERT INTO tick_lock (id, last_ran_at)
VALUES (1, '2000-01-01')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Atomic claim function ──────────────────────────────────────────────────
-- Returns TRUE if this caller successfully claimed the slot (i.e., it should
-- run the tick). Returns FALSE if another tick ran too recently.
--
-- The UPDATE is atomic at the Postgres row level — no explicit lock needed.
-- Two concurrent callers both passing the WHERE check is not possible because
-- the first UPDATE acquires a row-level lock; the second sees the updated
-- last_ran_at and fails the WHERE condition.
CREATE OR REPLACE FUNCTION claim_tick_slot(min_interval_ms INT DEFAULT 4000)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE tick_lock
  SET    last_ran_at = now()
  WHERE  id = 1
    AND  last_ran_at < now() - (min_interval_ms || ' milliseconds')::INTERVAL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE tick_lock ENABLE ROW LEVEL SECURITY;
-- Service role (used by serverSupa) bypasses RLS automatically.
-- No user-facing policies needed — this table is internal only.
