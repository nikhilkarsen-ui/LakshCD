// ============================================================
// Seed price history v2 — generates 7 days of realistic price
// history for all active players.
//
// Each player gets:
//   - A player-specific starting offset (stars trend up, slumpers down)
//   - 5 simulated game events at realistic evening times
//   - Per-game directional bias (good/bad performance)
//   - Volatility regime switching: calm between games, active during
//   - O-U mean reversion toward current_price throughout
//
// 30-min tick intervals × 336 ticks = exactly 7 days.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { PRICING_V3 as C } from '@/config/constants';

export const maxDuration = 300;

// ── Seeded PRNG (Mulberry32) — deterministic per player ─────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeGauss(rand: () => number) {
  return function (): number {
    const u = Math.max(1e-10, 1 - rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = (Math.imul(h, 16777619) >>> 0);
  }
  return h;
}

// ── Player profile ───────────────────────────────────────────────────────────
// Returns starting offset and volatility parameters calibrated to the player.
function playerProfile(p: any): {
  startFrac: number;       // signed fraction: negative = started below (uptrend), positive = above (downtrend)
  sigmaBetween: number;    // noise scale between games (relative to price)
  sigmaGame: number;       // noise scale during game windows
  gameImpactMag: number;   // magnitude of directional game bias
} {
  const price = Number(p.current_price);
  const ppg   = Number(p.ppg);
  const gp    = Number(p.games_played ?? 0);
  const nh    = nameHash(p.name);
  const rand  = mulberry32(nh);

  // ── Starting offset ──
  // Elite players (high price, high scoring): mostly uptrend — started lower
  // Injured/returning: bigger discount — recovering arc
  // Mid-tier: mixed direction
  // Role players: small offset
  let startFrac: number;
  if (gp < 25) {
    // Returning from injury — significant dip, recovering
    startFrac = -(0.12 + rand() * 0.10);
  } else if (price > 220 && ppg > 22) {
    // Elite scorer on a roll — gradual uptrend this week
    startFrac = -(0.05 + rand() * 0.07);
  } else if (price > 150) {
    // Good player, mixed recent form
    const dir = (nh % 3 === 0) ? 1 : -1;
    startFrac = dir * (0.04 + rand() * 0.08);
  } else if (price > 80) {
    // Mid-tier — more variance in 7-day path
    const dir = (nh % 5 < 2) ? 1 : -1;
    startFrac = dir * (0.06 + rand() * 0.10);
  } else {
    // Role player — low absolute moves
    const dir = (nh % 2 === 0) ? 1 : -1;
    startFrac = dir * (0.03 + rand() * 0.06);
  }

  // ── Volatility calibration ──
  // Higher relative sigma for cheaper players (less liquidity, bigger %)
  // Stars have tight bid-ask (smaller % moves)
  const tier = price > 220 ? 'star' : price > 140 ? 'mid' : price > 70 ? 'role' : 'bench';
  const sigmaBetween = { star: 0.0018, mid: 0.0028, role: 0.0040, bench: 0.0025 }[tier];
  const sigmaGame    = { star: 0.0070, mid: 0.0110, role: 0.0140, bench: 0.0080 }[tier];

  // Impact of "good vs bad game" directional bias (relative fraction of price per game tick)
  const gameImpactMag = { star: 0.0040, mid: 0.0060, role: 0.0080, bench: 0.0040 }[tier];

  return { startFrac, sigmaBetween, sigmaGame, gameImpactMag };
}

// ── Game schedule ────────────────────────────────────────────────────────────
// NBA April: ~3-4 games per team per week, evenings ET.
// EDT = UTC-4 → 7pm ET = 23:00 UTC.
// At 30-min ticks, 48 ticks/day. Evening = tick ~46-47 from day start.
//
// Simulated game days across the 7-day window (0-indexed):
//   Day 0, 1, 3, 4, 6 → 5 games (typical playoff-push schedule)
// Vary per team by ±1 tick jitter so not all 12 teams play the same slot.
function gameSlots(nh: number, rand: () => number, totalTicks: number): number[] {
  const TICKS_PER_DAY = 48;
  const EVENING = 46; // ~23:00 UTC from day start
  // Which days have games (spread to avoid back-to-back-to-back)
  const gameDays = [0, 1, 3, 4, 6];
  return gameDays.map(day => {
    const base   = day * TICKS_PER_DAY + EVENING;
    const jitter = Math.floor(rand() * 5); // 0-4 tick jitter (0–2h start variance)
    return Math.min(base + jitter, totalTicks - 20);
  });
}

// ── Game result per game ─────────────────────────────────────────────────────
// Stars have more good games. Returns bias direction per game slot.
function gameResults(p: any, rand: () => number): number[] {
  const price = Number(p.current_price);
  const goodBias = price > 200 ? 0.65 : price > 130 ? 0.55 : 0.50;
  return Array.from({ length: 5 }, () => {
    const r = rand();
    if (r < 1 - goodBias - 0.15) return -1; // bad game
    if (r < 1 - goodBias)        return  0; // mediocre
    return 1;                                // good game
  });
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

    const { data: players, error: pErr } = await db
      .from('players')
      .select('id, name, team, current_price, ppg, apg, rpg, efficiency, games_played, prior_fv_score, volatility')
      .eq('is_active', true)
      .order('team', { ascending: true });

    if (pErr || !players?.length) throw new Error(`Failed to load players: ${pErr?.message}`);
    log(`Loaded ${players.length} active players`);

    const playerIds = players.map((p: any) => p.id);
    await db.from('price_history').delete().in('player_id', playerIds);
    log(`Cleared existing price history`);

    // ── Tick parameters ──────────────────────────────────────────────────────
    const DAYS            = 7;
    const TICK_MS         = 30 * 60 * 1000;          // 30-minute intervals
    const TICKS           = DAYS * 24 * 2;            // 336
    const GAME_TICKS      = 8;                         // 4h game window
    const POST_GAME_TICKS = 6;                         // 3h cool-down

    const now       = Date.now();
    const startTime = now - TICKS * TICK_MS;

    // ── O-U parameters (scaled to 30-min ticks) ──────────────────────────────
    const ALPHA_BETWEEN  = 0.038;  // reversion between games (~18 tick half-life = 9h)
    const ALPHA_GAME     = 0.016;  // slower during game (prices being discovered)
    const ALPHA_POSTGAME = 0.055;  // faster snap after game

    const allInserts: any[] = [];

    for (const player of players as any[]) {
      const nh     = nameHash(player.name);
      const rand   = mulberry32(nh * 31337 + 7);
      const gauss  = makeGauss(rand);
      const target = Number(player.current_price);

      const { startFrac, sigmaBetween, sigmaGame, gameImpactMag } = playerProfile(player);
      const slots   = gameSlots(nh, rand, TICKS);
      const results = gameResults(player, rand);

      const evScore = parseFloat(Math.max(0, Math.min(1000, target / C.fv_scale)).toFixed(2));
      const vol     = Number(player.volatility ?? 0.05);

      let price = Math.max(C.min_price, target * (1 + startFrac));

      for (let i = 0; i < TICKS; i++) {
        const ts = new Date(startTime + i * TICK_MS).toISOString();

        // Determine regime
        const gameIdx = slots.findIndex(s => i >= s && i < s + GAME_TICKS);
        const inGame  = gameIdx >= 0;
        const postIdx = slots.findIndex(s => i >= s + GAME_TICKS && i < s + GAME_TICKS + POST_GAME_TICKS);
        const inPost  = postIdx >= 0;

        // O-U alpha
        const alpha = inGame ? ALPHA_GAME : inPost ? ALPHA_POSTGAME : ALPHA_BETWEEN;

        // Drift toward target
        const drift = alpha * (target - price);

        // Game bias: directional push during the game window
        let gameBias = 0;
        if (inGame) {
          const dir       = results[gameIdx];
          const tickDepth = i - slots[gameIdx];                    // 0..GAME_TICKS-1
          const envelope  = Math.sin(Math.PI * tickDepth / GAME_TICKS); // bell curve
          gameBias = dir * gameImpactMag * envelope * price;
        }

        // Noise
        const sigma  = inGame ? sigmaGame : sigmaBetween;
        const z      = Math.max(-2.8, Math.min(2.8, gauss()));
        const noise  = sigma * z * price;

        // Total move with per-tick cap (4% max for game ticks, 1.5% otherwise)
        const maxMove = price * (inGame ? 0.04 : 0.015);
        const raw     = drift + gameBias + noise;
        const delta   = Math.max(-maxMove, Math.min(maxMove, raw));

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

    log(`Generated ${allInserts.length} rows (${TICKS} ticks × ${players.length} players, 30-min intervals)`);

    const CHUNK = 5000;
    for (let i = 0; i < allInserts.length; i += CHUNK) {
      const { error: insErr } = await db.from('price_history').insert(allInserts.slice(i, i + CHUNK));
      if (insErr) throw new Error(`Chunk ${Math.floor(i / CHUNK) + 1} failed: ${insErr.message}`);
      log(`  Inserted chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(allInserts.length / CHUNK)}`);
    }

    log(`✓ Seeded ${allInserts.length} price history rows — 7-day window, 5 game events per player`);

    return NextResponse.json({
      success: true,
      players: players.length,
      rows_inserted: allInserts.length,
      ticks_per_player: TICKS,
      window_days: DAYS,
      logs,
    });

  } catch (err: any) {
    log(`ERROR: ${err.message}`);
    return NextResponse.json({ success: false, error: err.message, logs }, { status: 500 });
  }
}
