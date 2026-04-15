// ============================================================
// LAKSH — BallDontLie API Client
//
// Rate-limit-aware wrapper around the BDL REST API.
//
// Budget: 60 req/min on All-Star tier.
// We target ≤ 55 req/min (8% headroom) — well within limits even
// during peak usage (live games + retries + injury sync).
//
// Design:
//   - Every request is logged to bdl_poll_log in Supabase
//   - Before each request, count requests in the last 60s
//   - If count ≥ MAX_RPM, throw RateLimitError (caller backs off)
//   - Exponential backoff on 429 responses
//   - All requests go through bdlFetch() — never call BDL directly
//
// Endpoints used (all batch — never per-player):
//   GET /games?dates[]=YYYY-MM-DD          → today's schedule (1 req)
//   GET /live_box_scores                   → all in-progress games (1 req)
//   GET /stats?dates[]=YYYY-MM-DD&per_page=100  → completed game stats (1 req)
//   GET /season_averages/general?...       → season averages (1 req)
// ============================================================

import { serverSupa } from './supabase';

export const BDL_BASE = 'https://api.balldontlie.io/v1';

// Target: ≤ 55 requests/minute (8% headroom below 60/min hard limit)
const MAX_RPM = 55;

export class RateLimitError extends Error {
  constructor(public currentRpm: number) {
    super(`BDL rate limit budget reached: ${currentRpm} req in last 60s (max ${MAX_RPM})`);
  }
}

export class BDLApiError extends Error {
  constructor(public status: number, public endpoint: string, message: string) {
    super(`BDL ${status} on ${endpoint}: ${message}`);
  }
}

function bdlHeaders(): Record<string, string> {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error('BALLDONTLIE_API_KEY env var is not set');
  return { Authorization: key };
}

// ── Request counter ───────────────────────────────────────────────────────────

async function countRecentRequests(db: ReturnType<typeof serverSupa>): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db
    .from('bdl_poll_log')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since);
  return count ?? 0;
}

async function logRequest(
  db:         ReturnType<typeof serverSupa>,
  endpoint:   string,
  statusCode: number,
  durationMs: number,
): Promise<void> {
  await db.from('bdl_poll_log').insert({ endpoint, status_code: statusCode, duration_ms: durationMs });
  // Prune entries older than 2 minutes to keep the table small
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  await db.from('bdl_poll_log').delete().lt('created_at', cutoff);
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Rate-limited fetch wrapper. Every call goes through here.
 *
 * - Checks request budget before making the call
 * - Logs request + duration to bdl_poll_log
 * - Retries once on 429 (with 2s backoff)
 * - Throws BDLApiError on non-200 responses
 */
export async function bdlFetch(path: string, attempt = 0): Promise<any> {
  const db = serverSupa();

  // Budget check
  const rpm = await countRecentRequests(db);
  if (rpm >= MAX_RPM) throw new RateLimitError(rpm);

  const url   = `${BDL_BASE}${path}`;
  const start = Date.now();
  let statusCode = 0;

  try {
    const res = await fetch(url, { headers: bdlHeaders(), cache: 'no-store' });
    statusCode = res.status;
    const durationMs = Date.now() - start;

    // Fire-and-forget log (don't await — we don't want logging to slow the path)
    logRequest(db, path, statusCode, durationMs).catch(() => {});

    if (res.status === 429 && attempt === 0) {
      // One retry after 2 seconds
      await new Promise(r => setTimeout(r, 2000));
      return bdlFetch(path, 1);
    }

    if (res.status === 402 || res.status === 403 || res.status === 404) {
      // Tier doesn't support this endpoint — return null so caller can fall back
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BDLApiError(res.status, path, body.slice(0, 200));
    }

    return await res.json();
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BDLApiError) throw e;
    // Network error — log with status 0
    logRequest(db, path, 0, Date.now() - start).catch(() => {});
    throw e;
  }
}

// ── High-level endpoint wrappers ──────────────────────────────────────────────

/** Today's NBA game schedule. Returns the raw BDL games array. */
export async function fetchTodayGames(): Promise<any[]> {
  // NBA schedules are in ET — use ET date so this agrees with the schedule cache key
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const json  = await bdlFetch(`/games?dates[]=${today}&per_page=15`);
  return json?.data ?? [];
}

/**
 * Live in-progress box scores. Returns null on free-tier (402/403).
 * Shape: Map<bdl_player_id, statRow & { _game_id, _period, _time_remaining }>
 */
export async function fetchLiveBoxScores(): Promise<Map<number, any> | null> {
  const json = await bdlFetch('/live_box_scores');
  if (json === null) return null; // paid-tier endpoint unavailable

  const map = new Map<number, any>();
  for (const game of json.data ?? []) {
    const meta = { _game_id: game.id, _period: game.period, _time_remaining: game.time };
    for (const side of ['home_team_stats', 'visitor_team_stats'] as const) {
      for (const ps of game[side] ?? []) {
        if (ps?.player?.id != null) {
          map.set(Number(ps.player.id), { ...ps, ...meta });
        }
      }
    }
  }
  return map;
}

/**
 * Completed game stats for a given date.
 * Fetches all stats in a single paginated call (per_page=100 covers 15 players × 2 teams).
 * Shape: Map<bdl_player_id, statRow & { _game_id }>
 */
export async function fetchStatsByDate(date: string): Promise<Map<number, any>> {
  const json = await bdlFetch(`/stats?dates[]=${date}&per_page=100`);
  const map  = new Map<number, any>();
  for (const entry of json?.data ?? []) {
    if (entry?.player?.id != null) {
      map.set(Number(entry.player.id), { ...entry, _game_id: entry.game?.id ?? 0, _period: 0, _time_remaining: null });
    }
  }
  return map;
}

/**
 * Current injury report. Returns a map of bdl_player_id → injury row.
 * Shape: { player: { id, first_name, last_name }, status, description, updated_at }
 */
export async function fetchInjuries(): Promise<Map<number, any>> {
  const json = await bdlFetch('/player_injuries?per_page=100');
  const map  = new Map<number, any>();
  for (const entry of json?.data ?? []) {
    if (entry?.player?.id != null) {
      map.set(Number(entry.player.id), entry);
    }
  }
  return map;
}

/** Season averages for a list of BDL player IDs (single batched request). */
export async function fetchSeasonAverages(bdlIds: number[]): Promise<Map<number, any>> {
  const idParams = bdlIds.map(id => `player_ids[]=${id}`).join('&');
  const json     = await bdlFetch(`/season_averages?season=2025&${idParams}`);
  const map      = new Map<number, any>();
  for (const entry of json?.data ?? []) {
    if (entry?.player?.id != null) map.set(Number(entry.player.id), entry.stats);
  }
  return map;
}
