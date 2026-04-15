-- ============================================================
-- LAKSH — Analytics & Fee Tracking Migration
--
-- 1. Adds fee_rate + fee_charged columns to trades so transaction
--    fee revenue can be summed accurately.
--
-- 2. Creates user_sessions table for session/visit analytics:
--    - session start/end with duration
--    - page views and pages visited
--    - last_seen derived from most recent session
--
-- Run this in the Supabase SQL editor.
-- ============================================================

-- ── 1. Trade fee tracking ──────────────────────────────────────────────────────
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fee_rate    DECIMAL(8,6)  NOT NULL DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fee_charged DECIMAL(10,4) NOT NULL DEFAULT 0;

-- ── 2. User sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id       TEXT        NOT NULL UNIQUE,          -- client-generated UUID
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,                              -- set on session end
  page_views       INTEGER     NOT NULL DEFAULT 0,
  pages_visited    TEXT[]      NOT NULL DEFAULT '{}',    -- ordered list of pages seen
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user    ON user_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_session ON user_sessions(session_id);

ALTER TABLE user_sessions DISABLE ROW LEVEL SECURITY;
