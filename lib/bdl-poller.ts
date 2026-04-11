// ============================================================
// LAKSH — BDL Smart Poller
//
// Called by /api/stats/ingest on a cron schedule.
// Responsible for ALL BDL API traffic — nothing else calls BDL.
//
// Decision tree (runs on every cron invocation):
//
//   1. Check game_schedule_cache for today (0 API calls if fresh, <5 min old)
//      └─ If stale (>5 min old): fetch /games?dates[]=today (1 req)
//
//   2. Are any games currently in progress?
//      YES → /live_box_scores (1 req, All-Star tier — guaranteed available)
//             on unexpected null → fall back to /stats?dates[]=today (1 req)
//      NO, games later today → skip stat fetch entirely
//      NO, no games today → skip everything
//
//   3. Write stat results to live_stat_cache (Supabase)
//
// Total API budget:
//   No games today:        0–1 req per cron invocation
//   Games not started yet: 0–1 req per cron invocation
//   Games in progress:     1–2 req per cron invocation
//
// At 1 cron/min: max 2 req/min during games (3.3% of 60/min budget)
// At 1 cron/30s: max 4 req/min during games (6.7% of budget)
// Budget is effectively unlimited for this use case.
//
// Game status detection:
//   BDL game.status values: 'Final', '7:30 pm ET' (scheduled), 'Q3 5:22' (in progress)
//   We detect in-progress by the absence of 'Final' and presence of 'Q' or 'H' or 'OT'
// ============================================================

import { serverSupa } from './supabase';
import {
  fetchTodayGames,
  fetchLiveBoxScores,
  fetchStatsByDate,
  RateLimitError,
  BDLApiError,
} from './bdl-client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isInProgress(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  // BDL in-progress statuses look like: "Q1 5:22", "Q3 2:01", "HT", "OT 3:45"
  return /\bq[1-4]\b|\bht\b|\bot\b/.test(s);
}

function isFinal(status: string | null | undefined): boolean {
  if (!status) return false;
  return status.toLowerCase().includes('final');
}

function todayEasternDate(): string {
  // NBA game times are ET. Use ET date for schedule lookups.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // 'YYYY-MM-DD'
}

// ── Schedule cache ────────────────────────────────────────────────────────────

interface ScheduleCache {
  games:         any[];
  hasLiveGames:  boolean;
  hasFinalGames: boolean;
  hasAnyGames:   boolean;
}

// All-Star tier: 60 req/min budget. Refresh every 5 min so we detect
// game start/end within 5 minutes instead of up to 60.
// Cost: 1 req / 5 min = 12 req/hour — negligible.
const SCHEDULE_TTL_MS = 5 * 60 * 1000;

async function getGameSchedule(db: ReturnType<typeof serverSupa>): Promise<ScheduleCache> {
  const dateKey = todayEasternDate();

  // Check if we have a fresh cached schedule
  const { data: cached } = await db
    .from('game_schedule_cache')
    .select('*')
    .eq('date_key', dateKey)
    .single();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < SCHEDULE_TTL_MS) {
    const games = cached.games as any[];
    return {
      games,
      hasLiveGames:  games.some(g => isInProgress(g.status)),
      hasFinalGames: games.some(g => isFinal(g.status)),
      hasAnyGames:   games.length > 0,
    };
  }

  // Fetch fresh schedule (1 API request)
  let games: any[] = [];
  try {
    games = await fetchTodayGames();
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    console.error('Schedule fetch failed:', e);
    // Return stale cache if available rather than failing completely
    if (cached) {
      const g = cached.games as any[];
      return { games: g, hasLiveGames: g.some((x: any) => isInProgress(x.status)), hasFinalGames: g.some((x: any) => isFinal(x.status)), hasAnyGames: g.length > 0 };
    }
    games = [];
  }

  // Upsert into cache
  await db.from('game_schedule_cache').upsert({
    date_key:       dateKey,
    games,
    has_live_games: games.some(g => isInProgress(g.status)),
    fetched_at:     new Date().toISOString(),
  }, { onConflict: 'date_key' });

  return {
    games,
    hasLiveGames:  games.some(g => isInProgress(g.status)),
    hasFinalGames: games.some(g => isFinal(g.status)),
    hasAnyGames:   games.length > 0,
  };
}

// ── Write stat results to cache ───────────────────────────────────────────────

async function writeStatCache(
  db:        ReturnType<typeof serverSupa>,
  statsMap:  Map<number, any>,
  gameStatus: 'in_progress' | 'final',
  players:   Array<{ id: string; bdl_player_id: number }>,
): Promise<number> {
  const now    = new Date().toISOString();
  let written  = 0;

  for (const player of players) {
    const s = statsMap.get(player.bdl_player_id);

    if (!s) {
      // Player has a game today but no stats yet (bench, DNP, etc.)
      await db.from('live_stat_cache').upsert({
        player_id:     player.id,
        bdl_player_id: player.bdl_player_id,
        game_id:       0,
        game_status:   gameStatus,
        pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, tov: 0,
        fga: 0, fgm: 0, fta: 0, ftm: 0,
        period: 0, time_remaining: null,
        fetched_at: now,
      }, { onConflict: 'player_id' });
      continue;
    }

    const n = (v: any) => Number(v || 0);
    await db.from('live_stat_cache').upsert({
      player_id:      player.id,
      bdl_player_id:  player.bdl_player_id,
      game_id:        Number(s._game_id ?? 0),
      game_status:    gameStatus,
      pts:            n(s.pts),
      ast:            n(s.ast),
      reb:            n(s.reb),
      stl:            n(s.stl),
      blk:            n(s.blk),
      tov:            n(s.turnover ?? s.tov),
      fga:            n(s.fga),
      fgm:            n(s.fgm),
      fta:            n(s.fta),
      ftm:            n(s.ftm),
      period:         n(s._period),
      time_remaining: s._time_remaining ?? null,
      fetched_at:     now,
    }, { onConflict: 'player_id' });

    written++;
  }

  return written;
}

async function clearStatCache(
  db:      ReturnType<typeof serverSupa>,
  players: Array<{ id: string }>,
): Promise<void> {
  const now = new Date().toISOString();
  for (const player of players) {
    await db.from('live_stat_cache').upsert({
      player_id:   player.id,
      game_id:     0,
      game_status: 'no_game',
      pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, tov: 0,
      fga: 0, fgm: 0, fta: 0, ftm: 0,
      period: 0, time_remaining: null,
      fetched_at: now,
    }, { onConflict: 'player_id' });
  }
}

// ── Main poll function ────────────────────────────────────────────────────────

export interface PollResult {
  action:     'live' | 'final' | 'no_game' | 'no_poll' | 'rate_limited' | 'error';
  apiCalls:   number;
  written:    number;
  message:    string;
}

export async function runPoll(): Promise<PollResult> {
  const db = serverSupa();

  if (!process.env.BALLDONTLIE_API_KEY) {
    return { action: 'error', apiCalls: 0, written: 0, message: 'BALLDONTLIE_API_KEY not set' };
  }

  // Load mapped players (have bdl_player_id)
  const { data: players } = await db
    .from('players')
    .select('id, name, bdl_player_id')
    .eq('is_active', true)
    .eq('settlement_status', 'active')
    .not('bdl_player_id', 'is', null);

  if (!players?.length) {
    return { action: 'no_poll', apiCalls: 0, written: 0, message: 'No mapped players' };
  }

  const mappedPlayers = players.map((p: any) => ({
    id: p.id as string,
    bdl_player_id: Number(p.bdl_player_id),
  }));

  try {
    // ── Step 1: Check game schedule (0–1 API calls) ──────────────────────────
    const schedule = await getGameSchedule(db);
    let apiCalls   = 0; // schedule fetch is tracked inside getGameSchedule via bdl-client

    if (!schedule.hasAnyGames) {
      // No games today — reset all players and sleep
      await clearStatCache(db, mappedPlayers);
      return { action: 'no_game', apiCalls, written: 0, message: 'No NBA games today' };
    }

    if (!schedule.hasLiveGames && !schedule.hasFinalGames) {
      // Games scheduled but none started yet
      return { action: 'no_poll', apiCalls, written: 0, message: 'Games scheduled but not yet started' };
    }

    // ── Step 2: Fetch stats (1–2 API calls) ──────────────────────────────────
    let statsMap: Map<number, any> | null = null;
    let gameStatus: 'in_progress' | 'final' = 'final';

    if (schedule.hasLiveGames) {
      // All-Star tier: /live_box_scores is guaranteed available.
      // An empty map means the game just tipped off — keep as in_progress,
      // writeStatCache will write 0s for players not yet in the map.
      // Only fall back to /stats if the endpoint returns null (unexpected 402/403).
      try {
        statsMap   = await fetchLiveBoxScores();
        apiCalls++;
        gameStatus = 'in_progress';
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        statsMap = null;
      }
    }

    if (statsMap === null) {
      // /live_box_scores was unavailable (unexpected on All-Star tier) — fall back
      // to completed game stats so we don't return empty-handed.
      const date = todayEasternDate();
      try {
        statsMap   = await fetchStatsByDate(date);
        apiCalls++;
        gameStatus = schedule.hasLiveGames ? 'in_progress' : 'final';
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        console.error('Stats fetch failed:', e);
        return { action: 'error', apiCalls, written: 0, message: (e as Error).message };
      }
    }

    // ── Step 3: Write to cache ────────────────────────────────────────────────
    const written = await writeStatCache(db, statsMap, gameStatus, mappedPlayers);

    console.log(`BDL POLL [${gameStatus}]: ${apiCalls} API calls, ${written}/${mappedPlayers.length} players written`);

    return {
      action:   schedule.hasLiveGames ? 'live' : 'final',
      apiCalls,
      written,
      message: `${gameStatus}: ${written} players updated`,
    };

  } catch (e) {
    if (e instanceof RateLimitError) {
      console.warn('BDL rate limit reached:', e.message);
      return { action: 'rate_limited', apiCalls: 0, written: 0, message: e.message };
    }
    console.error('Poll error:', e);
    return { action: 'error', apiCalls: 0, written: 0, message: (e as Error).message };
  }
}
