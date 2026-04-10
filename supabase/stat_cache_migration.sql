-- ============================================================
-- LAKSH — Stat Cache Migration
-- Decouples BDL polling from the pricing tick.
-- The poller writes here; the pricing engine reads from here.
-- BDL is never called inside the pricing tick.
-- ============================================================

-- ── 1. live_stat_cache ────────────────────────────────────────────────────────
-- One row per player. Updated by the BDL poller every ~30 seconds.
-- The pricing tick reads this table to apply per-event price bumps.
CREATE TABLE IF NOT EXISTS live_stat_cache (
  player_id       UUID         NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  bdl_player_id   INTEGER      NOT NULL,
  game_id         INTEGER      NOT NULL DEFAULT 0,
  game_status     TEXT         NOT NULL DEFAULT 'no_game',
  -- 'no_game' | 'scheduled' | 'in_progress' | 'final'
  -- Stats from the current (or most recent) game
  pts             DECIMAL(6,2) NOT NULL DEFAULT 0,
  ast             DECIMAL(6,2) NOT NULL DEFAULT 0,
  reb             DECIMAL(6,2) NOT NULL DEFAULT 0,
  stl             DECIMAL(6,2) NOT NULL DEFAULT 0,
  blk             DECIMAL(6,2) NOT NULL DEFAULT 0,
  tov             DECIMAL(6,2) NOT NULL DEFAULT 0,
  fga             DECIMAL(6,2) NOT NULL DEFAULT 0,
  fgm             DECIMAL(6,2) NOT NULL DEFAULT 0,
  fta             DECIMAL(6,2) NOT NULL DEFAULT 0,
  ftm             DECIMAL(6,2) NOT NULL DEFAULT 0,
  -- Quarter / time context (informational, shown in UI)
  period          INTEGER      NOT NULL DEFAULT 0,
  time_remaining  TEXT         DEFAULT NULL,
  -- When the poller last successfully wrote this row
  fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id)
);

CREATE INDEX IF NOT EXISTS live_stat_cache_fetched_idx ON live_stat_cache (fetched_at);
CREATE INDEX IF NOT EXISTS live_stat_cache_game_status_idx ON live_stat_cache (game_status);

-- ── 2. bdl_poll_log ───────────────────────────────────────────────────────────
-- Tracks every request made to BDL. Used to enforce rate limits and
-- monitor usage. Pruned automatically to last 2 minutes of history.
CREATE TABLE IF NOT EXISTS bdl_poll_log (
  id          BIGSERIAL    PRIMARY KEY,
  endpoint    TEXT         NOT NULL,
  status_code INTEGER      NOT NULL DEFAULT 200,
  duration_ms INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bdl_poll_log_created_idx ON bdl_poll_log (created_at);

-- ── 3. game_schedule_cache ────────────────────────────────────────────────────
-- Caches today's game schedule. Checked once and reused all day.
-- The poller uses this to decide whether to poll live stats at all.
CREATE TABLE IF NOT EXISTS game_schedule_cache (
  date_key       TEXT        NOT NULL PRIMARY KEY, -- 'YYYY-MM-DD'
  games          JSONB       NOT NULL DEFAULT '[]',
  has_live_games BOOLEAN     NOT NULL DEFAULT false,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- live_stat_cache is read-only for authenticated users (for /api/live-data)
ALTER TABLE live_stat_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bdl_poll_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_schedule_cache ENABLE ROW LEVEL SECURITY;

-- Public read on live_stat_cache (game stats are not sensitive)
DO $$ BEGIN
  CREATE POLICY "Public read live_stat_cache"
    ON live_stat_cache FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role handles all writes (bypasses RLS automatically)
