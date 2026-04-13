// ============================================================
// LAKSH — Live Game Pricing
// ============================================================
// Reads from live_stat_cache (written by bdl-poller.ts every ~30s).
// Never calls BDL directly — that is bdl-poller.ts's job.
//
// On each sync:
//   1. Read live_stat_cache for all mapped active players
//   2. Diff against stored live_stats_snapshot on each player
//   3. Apply per-event price bumps for new stat events
//   4. Update live_game_boost (EFV-drift target)
//   5. Skip players with game_status = 'no_game'
//
// Price impact per event (see config/constants.ts LIVE_STATS):
//   +0.06% per point, +0.08% per assist, +0.03% per rebound,
//   +0.10% per steal, +0.08% per block, -0.05% per turnover.
//
// Impacts compound multiplicatively so a 30-pt game at one poll
// (e.g. first poll of a completed game) = +1.8% from points alone.
// A monster 30/10/10 with 4 tov ≈ +3.8% net — on a $300 share ~+$11.
//
// The tick (every 5s) continues to drift price toward EFV and
// recalibrates AMM pools — so live bumps are immediately reflected
// in the market. The live_game_boost column shifts the EFV target
// so drift reinforces the live move rather than fighting it.
//
// Snapshot shape: { game_id, pts, ast, reb, stl, blk, tov }
//   Stored per-player. A new game_id resets the delta base to zero.
// ============================================================

import { serverSupa } from './supabase';
import { LIVE_STATS } from '@/config/constants';

const BOOST_TTL_MS  = 4 * 60 * 60 * 1000; // reset boost 4h after last game event
const MAX_PRICE_BUMP = 0.05;               // single-sync price move capped at ±5%

// NBA Efficiency = PTS + REB + AST + STL + BLK − (FGA−FGM) − (FTA−FTM) − TOV
function computeEfficiency(s: {
  pts: number; reb: number; ast: number; stl: number; blk: number;
  fga: number; fgm: number; fta: number; ftm: number; tov: number;
}): number {
  return (
    s.pts + s.reb + s.ast + s.stl + s.blk
    - (s.fga - s.fgm)
    - (s.fta - s.ftm)
    - s.tov
  );
}

// tanh-based boost for the EFV target drift (-1..+1).
// Compares cumulative game pts/ast/reb to season averages.
// Intentionally excludes shooting efficiency: missed shots are already
// reflected in lower point totals. Penalising them again in the boost
// caused elite high-volume scorers (e.g. Jokic) to show negative boosts
// on legitimately good games, making price fall while they were playing well.
function computeBoost(
  seasonPpg: number, seasonApg: number, seasonRpg: number, _seasonEff: number,
  gamePts:   number, gameAst:   number, gameReb:   number, _gameEff:   number,
): number {
  const ratio = (season: number, game: number) =>
    season > 0 ? (game - season) / season : 0;
  const raw =
    ratio(seasonPpg, gamePts) * 0.50 +   // points: primary driver
    ratio(seasonApg, gameAst) * 0.30 +   // assists
    ratio(seasonRpg, gameReb) * 0.20;    // rebounds
  return parseFloat(Math.tanh(raw * 1.5).toFixed(4));
}

interface StatSnapshot {
  game_id: number;
  pts: number; ast: number; reb: number;
  stl: number; blk: number; tov: number;
}

// Compute the fractional price multiplier from new stat events since last snapshot.
// Returns a value like 1.012 (price up 1.2%) or 0.991 (price down 0.9%).
function statDeltaMultiplier(prev: StatSnapshot | null, next: StatSnapshot): number {
  // New game (or first game ever): treat all stats as fresh events
  const base: StatSnapshot = (prev && prev.game_id === next.game_id)
    ? prev
    : { game_id: next.game_id, pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, tov: 0 };

  const d = {
    pts: Math.max(0, next.pts - base.pts),
    ast: Math.max(0, next.ast - base.ast),
    reb: Math.max(0, next.reb - base.reb),
    stl: Math.max(0, next.stl - base.stl),
    blk: Math.max(0, next.blk - base.blk),
    tov: Math.max(0, next.tov - base.tov),
  };

  // No new events — multiplier is exactly 1
  if (!d.pts && !d.ast && !d.reb && !d.stl && !d.blk && !d.tov) return 1;

  const pctChange =
    d.pts * LIVE_STATS.pts +
    d.ast * LIVE_STATS.ast +
    d.reb * LIVE_STATS.reb +
    d.stl * LIVE_STATS.stl +
    d.blk * LIVE_STATS.blk +
    d.tov * LIVE_STATS.tov;

  // Cap single-sync move at MAX_PRICE_BUMP
  const capped = Math.max(-MAX_PRICE_BUMP, Math.min(MAX_PRICE_BUMP, pctChange));
  return 1 + capped;
}

export interface LiveSyncResult {
  updated: number;  // players processed (had game data)
  boosted: number;  // of those, how many had new stat events → price bumped
  reset:   number;  // players reset (no game today)
  errors:  string[];
}

export async function syncLiveBoosts(): Promise<LiveSyncResult> {
  const db      = serverSupa();
  const errors: string[] = [];
  let updated = 0;
  let boosted = 0;
  let reset   = 0;

  // Load active players with season-avg stats and current pricing state
  const { data: players, error } = await db
    .from('players')
    .select('id, name, bdl_player_id, ppg, apg, rpg, efficiency, current_price, live_stats_snapshot')
    .eq('is_active', true)
    .eq('settlement_status', 'active')
    .not('bdl_player_id', 'is', null);

  if (error || !players?.length) {
    return { updated: 0, boosted: 0, reset: 0, errors: ['Failed to load players or no mapped players'] };
  }

  // Read live_stat_cache for all of these players in one query (no BDL call)
  const playerIds = players.map((p: any) => p.id as string);
  const { data: cacheRows } = await db
    .from('live_stat_cache')
    .select('player_id, game_id, game_status, pts, ast, reb, stl, blk, tov, fga, fgm, fta, ftm, period, time_remaining, fetched_at')
    .in('player_id', playerIds);

  // Index cache by player_id for O(1) lookup
  const cacheMap = new Map<string, any>();
  for (const row of cacheRows ?? []) {
    cacheMap.set(row.player_id, row);
  }

  const now       = new Date().toISOString();
  const expiresAt = new Date(Date.now() + BOOST_TTL_MS).toISOString();

  for (const player of players) {
    const cache = cacheMap.get(player.id);

    // No cache entry or explicitly no game → reset
    if (!cache || cache.game_status === 'no_game') {
      await db.from('players').update({
        live_game_boost:       0,
        live_boost_expires_at: null,
        live_stats_snapshot:   null,
        updated_at:            now,
      }).eq('id', player.id);
      reset++;
      continue;
    }

    // Games scheduled but not yet started — don't touch prices, don't reset
    if (cache.game_status === 'scheduled') continue;

    const n = (v: any) => Number(v ?? 0);

    const nextSnapshot: StatSnapshot = {
      game_id: n(cache.game_id),
      pts:     n(cache.pts),
      ast:     n(cache.ast),
      reb:     n(cache.reb),
      stl:     n(cache.stl),
      blk:     n(cache.blk),
      tov:     n(cache.tov),
    };

    const prevSnapshot: StatSnapshot | null = player.live_stats_snapshot ?? null;
    const multiplier = statDeltaMultiplier(prevSnapshot, nextSnapshot);

    const currentPrice = Number(player.current_price);
    const newPrice = multiplier !== 1
      ? parseFloat(Math.max(5, currentPrice * multiplier).toFixed(2))
      : currentPrice;

    // EFV-drift boost from cumulative game stats vs season averages
    const gameEff = computeEfficiency({
      pts: nextSnapshot.pts, reb: nextSnapshot.reb, ast: nextSnapshot.ast,
      stl: nextSnapshot.stl, blk: nextSnapshot.blk,
      fga: n(cache.fga), fgm: n(cache.fgm),
      fta: n(cache.fta), ftm: n(cache.ftm),
      tov: nextSnapshot.tov,
    });
    const boost = computeBoost(
      Number(player.ppg), Number(player.apg), Number(player.rpg), Number(player.efficiency),
      nextSnapshot.pts,   nextSnapshot.ast,   nextSnapshot.reb,   gameEff,
    );

    const update: Record<string, any> = {
      live_game_boost:       boost,
      live_boost_expires_at: expiresAt,
      live_stats_snapshot:   nextSnapshot,
      updated_at:            now,
    };

    if (multiplier !== 1) {
      update.previous_price = currentPrice;
      update.current_price  = newPrice;
    }

    await db.from('players').update(update).eq('id', player.id);

    if (multiplier !== 1) {
      // Record in price_history so charts reflect the live bump
      await db.from('price_history').insert({
        player_id:      player.id,
        price:          newPrice,
        expected_value: 0, // tick will fill on next cycle
        volatility:     0,
        created_at:     now,
      });
    }

    updated++;
    if (multiplier !== 1) boosted++;

    const pctStr = multiplier !== 1
      ? ` → price ${((multiplier - 1) * 100).toFixed(2)}% ($${currentPrice} → $${newPrice})`
      : ' (no new events)';

    console.log(
      `LIVE [${cache.game_status}] ${player.name}: ` +
      `pts=${nextSnapshot.pts} ast=${nextSnapshot.ast} reb=${nextSnapshot.reb} ` +
      `stl=${nextSnapshot.stl} blk=${nextSnapshot.blk} tov=${nextSnapshot.tov}` +
      pctStr
    );
  }

  return { updated, boosted, reset, errors };
}
