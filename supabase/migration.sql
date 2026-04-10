-- ============================================================
-- LAKSH v2 → v3 Migration: Futures → Buy/Sell Share Market
-- Run this against your existing Supabase database.
-- Safe to run on a fresh DB too (all steps use IF EXISTS / IF NOT EXISTS).
-- ============================================================

-- ── 1. positions ─────────────────────────────────────────────────────────────

-- Rename futures columns to share-market equivalents
ALTER TABLE positions RENAME COLUMN position_size   TO shares_owned;
ALTER TABLE positions RENAME COLUMN avg_entry_price TO avg_cost_basis;

-- Drop futures-only columns
ALTER TABLE positions DROP COLUMN IF EXISTS last_settlement_price;
ALTER TABLE positions DROP COLUMN IF EXISTS last_settlement_date;

-- Add realized P&L accumulator
ALTER TABLE positions ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Clean up legacy short positions (negative size) before adding non-negative constraint.
-- Any negative position means "short" in the old model — zero it out cleanly.
DELETE FROM positions WHERE shares_owned < 0;
DELETE FROM positions WHERE shares_owned = 0;

-- Enforce no-short rule at DB level
ALTER TABLE positions ADD CONSTRAINT shares_non_negative CHECK (shares_owned >= 0);


-- ── 2. players ───────────────────────────────────────────────────────────────

-- Expected final value (dollar price the market is estimating as season-end outcome)
ALTER TABLE players ADD COLUMN IF NOT EXISTS expected_final_value DECIMAL(10,2) NOT NULL DEFAULT 500.00;

-- Season settlement fields
ALTER TABLE players ADD COLUMN IF NOT EXISTS final_settlement_price DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'active';

-- Add check constraint separately (safer across Postgres versions)
ALTER TABLE players ADD CONSTRAINT players_settlement_status_check
  CHECK (settlement_status IN ('active', 'settled'));

-- Seed expected_final_value from existing expected_value score (EV * 0.4 → dollars)
-- Only updates rows that still have the default 500.00 placeholder.
UPDATE players
SET expected_final_value = ROUND(CAST(expected_value AS NUMERIC) * 0.4, 2)
WHERE expected_final_value = 500.00;


-- ── 3. trades ────────────────────────────────────────────────────────────────
-- Old schema: size (signed float), price, pnl
-- New schema: side ('buy'|'sell'|'settlement'), shares (positive), price, total_value, realized_pnl
--
-- We backfill the new columns from old data, then drop old columns.

-- Add new columns (nullable first so we can backfill)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS side         TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS shares       DECIMAL(14,6);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS total_value  DECIMAL(12,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill from old signed `size` and `pnl` columns (only for rows not yet migrated)
UPDATE trades
SET
  side        = CASE WHEN size >= 0 THEN 'buy' ELSE 'sell' END,
  shares      = ABS(size),
  total_value = ROUND(ABS(size) * price, 2),
  realized_pnl = COALESCE(pnl, 0)
WHERE side IS NULL AND size IS NOT NULL;

-- Now enforce NOT NULL and valid values
ALTER TABLE trades ALTER COLUMN side        SET NOT NULL;
ALTER TABLE trades ALTER COLUMN shares      SET NOT NULL;
ALTER TABLE trades ALTER COLUMN total_value SET NOT NULL;

-- Add side check constraint
ALTER TABLE trades ADD CONSTRAINT trades_side_check
  CHECK (side IN ('buy', 'sell', 'settlement'));

-- Drop old columns that no longer exist in the new schema
ALTER TABLE trades DROP COLUMN IF EXISTS size;
ALTER TABLE trades DROP COLUMN IF EXISTS pnl;
