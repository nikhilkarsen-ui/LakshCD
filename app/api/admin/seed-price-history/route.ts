// ============================================================
// Seed price history — generates 24h of realistic price history
// for all active players using the same O-U model as the live
// no-game tick (pricing-v3 / NO_GAME_PRICING constants).
//
// Each player gets:
//   - A historically-motivated starting offset 24h ago
//   - 288 ticks (5-min intervals) of O-U mean reversion toward FV
//   - Volatility calibrated to their price tier and games played
//   - Injury-aware dips for players with low games_played
//
// Auth: x-admin-secret header
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { PRICING_V3 as C, NO_GAME_PRICING as NG, SEASON } from '@/config/constants';

export const maxDuration = 300;

// ── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
// Deterministic so re-runs produce the same history.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Box-Muller using the seeded RNG
function makeGauss(rand: () => number) {
  return function (): number {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

// ── Fair value replication (mirrors computeFairValue in pricing-v3.ts) ───────
function computeFV(player: any): number {
  const gp = Math.max(1, Number(player.games_played));
  const projPts = Number(player.ppg)        * SEASON.total_games;
  const projAst = Number(player.apg)        * SEASON.total_games;
  const projReb = Number(player.rpg)        * SEASON.total_games;
  const projEff = Number(player.efficiency) * SEASON.total_games;

  const rawScore =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;

  const progress = (() => {
    const start = new Date(SEASON.start_date).getTime();
    const end   = new Date(SEASON.settlement_date).getTime();
    const now   = Date.now();
    if (now <= start) return 0;
    if (now >= end)   return 1;
    return (now - start) / (end - start);
  })();

  let availabilityDiscount = 1.0;
  if (progress > 0.20) {
    const expectedGames  = Math.floor(SEASON.total_games * progress);
    const gamesRatio     = Math.min(1, gp / Math.max(1, expectedGames));
    availabilityDiscount = 0.5 + 0.5 * gamesRatio;
  }

  const prior       = Number(player.prior_fv_score ?? C.league_avg_score);
  const credibility = Math.min(gp / C.credibility_games, 1);
  const shrunkScore = credibility * rawScore + (1 - credibility) * prior;

  const evScore = Math.max(0, Math.min(1000, shrunkScore * 1000 * availabilityDiscount));
  return Math.max(C.min_price, parseFloat((evScore * C.fv_scale).toFixed(2)));
}

// ── Historical offset & volatility profile ───────────────────────────────────
//
// We model the "what happened in the last 24h" narrative:
//   - Players with low games_played (injured/returning) get a larger starting
//     offset because their price was more uncertain before recent games.
//   - Role players (low price) get slightly higher relative volatility.
//   - Stars get lower relative noise (deep market = tight spreads).
//
function playerProfile(player: any, fv: number): {
  startOffsetFrac: number;  // fractional offset from FV at t-24h (signed)
  sigmaMultiplier: number;  // scales NG.sigma_base
} {
  const gp       = Number(player.games_played ?? 0);
  const price    = Number(player.current_price ?? fv);
  const progress = Math.min(1, gp / 60); // 60 games ≈ full season credibility

  // Injured / returning players had more price uncertainty
  const injuryOffset = gp < 30 ? 0.06 * (1 - gp / 30) : 0;

  // Seed direction from player name (deterministic variety)
  const nameSum = player.name.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  const direction = ((nameSum % 3) - 1); // -1, 0, or +1

  // Base offset: stars ±2%, mid-tier ±4%, role players ±6%
  const tierOffset = price > 250 ? 0.02 : price > 150 ? 0.04 : 0.06;
  const startOffsetFrac = direction * (tierOffset + injuryOffset);

  // Volatility: inverse of market depth (high price = tighter market)
  const sigmaMultiplier = price > 250 ? 0.8 : price > 150 ? 1.0 : 1.3;

  return { startOffsetFrac, sigmaMultiplier };
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log('[seed-price-history]', msg); };

  try {
    const db = serverSupa();

    // Load all active players
    const { data: players, error: pErr } = await db
      .from('players')
      .select('id, name, team, current_price, ppg, apg, rpg, efficiency, games_played, prior_fv_score, volatility')
      .eq('is_active', true)
      .order('team', { ascending: true });

    if (pErr || !players?.length) throw new Error(`Failed to load players: ${pErr?.message}`);
    log(`Loaded ${players.length} active players`);

    // Delete existing price history for these players
    const playerIds = players.map((p: any) => p.id);
    const { error: delErr } = await db.from('price_history').delete().in('player_id', playerIds);
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`);
    log(`Cleared existing price history for ${players.length} players`);

    // Generate 288 ticks per player (24h at 5-min intervals)
    const TICKS        = 288;
    const TICK_MS      = 5 * 60 * 1000;
    const now          = Date.now();
    const startTime    = now - TICKS * TICK_MS;

    const allInserts: any[] = [];

    for (const player of players as any[]) {
      const fv             = computeFV(player);
      const { startOffsetFrac, sigmaMultiplier } = playerProfile(player, fv);

      // Seeded RNG per player for deterministic output
      const nameHash = player.name.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
      const rand     = mulberry32(nameHash * 31337);
      const gauss    = makeGauss(rand);

      const alpha    = NG.alpha_base;
      const sigma    = NG.sigma_base * sigmaMultiplier;
      const clamp    = NG.noise_clamp;
      const maxTick  = NG.max_tick_pct;

      // Starting price: offset from FV (not current_price) to avoid anchoring
      let price = fv * (1 + startOffsetFrac);
      price = Math.max(C.min_price, price);

      // EV score for this player (constant over the 24h window — stats didn't change)
      const evScore = parseFloat(Math.max(0, Math.min(1000, (fv / C.fv_scale))).toFixed(2));
      const vol     = Number(player.volatility ?? 0.05);

      for (let i = 0; i < TICKS; i++) {
        const ts = new Date(startTime + i * TICK_MS).toISOString();

        // O-U step: drift toward FV + clamped Gaussian noise
        const drift   = alpha * (fv - price);
        const z       = Math.max(-clamp, Math.min(clamp, gauss()));
        const noise   = sigma * z * price;
        const raw     = price + drift + noise;

        // Per-tick cap
        const maxMove = price * maxTick;
        const delta   = Math.max(-maxMove, Math.min(maxMove, raw - price));
        price = Math.max(C.min_price, price + delta);

        allInserts.push({
          player_id:      player.id,
          price:          parseFloat(price.toFixed(2)),
          expected_value: evScore,
          volatility:     vol,
          created_at:     ts,
        });
      }
    }

    log(`Generated ${allInserts.length} history points (${TICKS} per player)`);

    // Batch insert in chunks of 5000 to avoid payload limits
    const CHUNK = 5000;
    for (let i = 0; i < allInserts.length; i += CHUNK) {
      const chunk = allInserts.slice(i, i + CHUNK);
      const { error: insErr } = await db.from('price_history').insert(chunk);
      if (insErr) throw new Error(`Insert chunk ${i / CHUNK + 1} failed: ${insErr.message}`);
      log(`  Inserted chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(allInserts.length / CHUNK)}`);
    }

    log(`✓ Seeded ${allInserts.length} price history rows for ${players.length} players`);

    return NextResponse.json({
      success: true,
      players: players.length,
      rows_inserted: allInserts.length,
      ticks_per_player: TICKS,
      window_hours: 24,
      logs,
    });

  } catch (err: any) {
    log(`ERROR: ${err.message}`);
    console.error('[seed-price-history] Fatal:', err);
    return NextResponse.json({ success: false, error: err.message, logs }, { status: 500 });
  }
}
