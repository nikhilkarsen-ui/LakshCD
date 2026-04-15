// ============================================================
// Price tick — runs every 5 seconds (Pricing Engine v3).
//
// Per tick:
//   1. Compute oracle FV with Bayesian shrinkage + availability discount
//   2. Compute 30-min TWAP and EWMA volatility from price history
//   3. Drift AMM spot toward FV (rubber-band strengthens far from FV)
//   4. Blend: 15% AMM + 65% FV + 20% TWAP (oracle-dominant)
//   5. Recalibrate AMM pools to blended price
//   6. Evaluate momentum circuit breaker (set flag if >8% rise / 30min)
//   7. Write blended price to price_history
//   8. Prune history older than 7 days
//
// Auth: x-cron-secret header (scheduler) OR valid user JWT
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { tick, noGameTick } from '@/lib/pricing-v3';
import { runSettlement, processPendingOrders } from '@/lib/trading';
import { getUser, getAppUser } from '@/lib/auth';
import { Player, PricePoint } from '@/types';
import { SEASON, PRICING_V3 as C } from '@/config/constants';
export const dynamic = 'force-dynamic';

const NF = [
  'current_price', 'previous_price', 'expected_value', 'expected_final_value',
  'fair_value', 'twap_price', 'twap_30m', 'volatility', 'market_depth',
  'volume_24h', 'last_fee_rate', 'blend_w_amm', 'blend_w_fv', 'blend_w_twap',
  'ppg', 'apg', 'rpg', 'efficiency', 'games_played',
  'pool_x', 'pool_y', 'live_game_boost', 'prior_fv_score',
];

export async function POST(req: NextRequest) {
  const cronSecret   = req.headers.get('x-cron-secret');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const validCron    = isVercelCron || (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!validCron) {
    // Non-cron callers must be approved users (not just any valid JWT)
    const appUser = await getAppUser(req);
    if (!appUser?.is_approved) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Settlement gate
    if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
      const result = await runSettlement();
      return NextResponse.json({ success: true, settled: result, timestamp: new Date().toISOString() });
    }

    const db = serverSupa();

    // ── Distributed dedup lock ─────────────────────────────────────────────
    // Atomically claim the tick slot. If another request ran within the last
    // 4 seconds, this UPDATE matches no rows and we return early.
    // If the RPC fails for any reason, fall through and run the tick anyway.
    const { data: claimed, error: lockError } = await db.rpc('claim_tick_slot', { min_interval_ms: 4000 });
    if (!lockError && claimed === false) {
      return NextResponse.json({ success: true, skipped: true });
    }

    // ── Load active players ────────────────────────────────────────────────
    const { data: players } = await db
      .from('players')
      .select('*')
      .eq('is_active', true)
      .eq('settlement_status', 'active');
    if (!players?.length) return NextResponse.json({ error: 'No active players' }, { status: 500 });

    for (const p of players)
      for (const f of NF)
        if (p[f] !== undefined && p[f] !== null) p[f] = Number(p[f]);

    // ── Load price history — 60 ticks for vol/TWAP, older for momentum check
    // Momentum looks back 30 min = 360 ticks at 5s cadence.
    const historyLookback = new Date(Date.now() - 35 * 60 * 1000).toISOString(); // 35 min
    const { data: allHist } = await db
      .from('price_history')
      .select('*')
      .in('player_id', players.map((p: any) => p.id))
      .gte('created_at', historyLookback)
      .order('created_at', { ascending: false })
      .limit(500 * players.length);

    const histories: Record<string, PricePoint[]> = {};
    for (const h of allHist || []) {
      h.price          = Number(h.price);
      h.expected_value = Number(h.expected_value);
      h.volatility     = Number(h.volatility);
      if (!histories[h.player_id]) histories[h.player_id] = [];
      histories[h.player_id].push(h);
    }
    for (const k of Object.keys(histories)) histories[k].reverse(); // oldest first

    // ── 24h-ago prices for change% ────────────────────────────────────────
    const ago24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: prices24hAgo } = await db
      .from('price_history')
      .select('player_id, price')
      .in('player_id', players.map((p: any) => p.id))
      .lte('created_at', ago24h)
      .order('created_at', { ascending: false })
      .limit(players.length);

    const price24hMap: Record<string, number> = {};
    for (const row of prices24hAgo || [])
      if (!price24hMap[row.player_id]) price24hMap[row.player_id] = Number(row.price);

    // ── 24h trade volume ─────────────────────────────────────────────────
    const { data: volumes } = await db
      .from('trades')
      .select('player_id, total_value')
      .in('player_id', players.map((p: any) => p.id))
      .gte('created_at', ago24h)
      .in('side', ['buy', 'sell']);

    const volume24hMap: Record<string, number> = {};
    for (const row of volumes || [])
      volume24hMap[row.player_id] = (volume24hMap[row.player_id] ?? 0) + Number(row.total_value);

    // ── 30-min trade volume (for TWAP anomaly dampening) ─────────────────
    const ago30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: volumes30m } = await db
      .from('trades')
      .select('player_id, total_value')
      .in('player_id', players.map((p: any) => p.id))
      .gte('created_at', ago30m)
      .in('side', ['buy', 'sell']);

    const volume30mMap: Record<string, number> = {};
    for (const row of volumes30m || [])
      volume30mMap[row.player_id] = (volume30mMap[row.player_id] ?? 0) + Number(row.total_value);

    const now = new Date().toISOString();
    const inserts: any[] = [];

    // ── Game state: determine if live games are active ────────────────────
    // Reads from game_schedule_cache (written by bdl-poller every hour).
    // Falls back to live tick if cache is absent (safe default).
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { data: scheduleRow } = await db
      .from('game_schedule_cache')
      .select('has_live_games, games, fetched_at')
      .eq('date_key', todayKey)
      .single();

    const hasLiveGames = scheduleRow?.has_live_games ?? false;

    // Compute hours until next game tip-off for O-U proximity scaling
    let hoursUntilNextGame = Infinity;
    if (scheduleRow?.games) {
      const games = scheduleRow.games as any[];
      const now = Date.now();
      for (const g of games) {
        if (g.status && !/final/i.test(g.status) && !/\bq[1-4]\b|\bht\b|\bot\b/i.test(g.status)) {
          // Scheduled game — try to parse tip-off time
          const d = g.date ? new Date(g.date).getTime() : NaN;
          if (!isNaN(d) && d > now) {
            const h = (d - now) / 3_600_000;
            if (h < hoursUntilNextGame) hoursUntilNextGame = h;
          }
        }
      }
    }

    // ── Tick each player ─────────────────────────────────────────────────
    for (const p of players) {
      const vol24h           = volume24hMap[p.id] ?? 0;
      const lastTradeAt      = p.last_trade_at ? new Date(p.last_trade_at).getTime() : 0;
      const timeSinceTradeMs = lastTradeAt > 0 ? Date.now() - lastTradeAt : 60 * 60 * 1000;

      const vol30m = volume30mMap[p.id] ?? 0;

      // Route to O-U no-game model when market is quiet
      const t = hasLiveGames
        ? tick(p as Player, histories[p.id] ?? [], vol24h, timeSinceTradeMs, vol30m)
        : noGameTick(p as Player, histories[p.id] ?? [], hoursUntilNextGame, vol24h);

      const prev         = p.current_price;
      const price24hAgo  = price24hMap[p.id] ?? prev;
      const change24h    = t.blendedPrice - price24hAgo;
      const changePct24h = price24hAgo > 0 ? (change24h / price24hAgo) * 100 : 0;

      // Momentum circuit breaker management
      const breakerUntil = t.momentumBreaker
        ? new Date(Date.now() + C.momentum_cooldown_ms).toISOString()
        : (p.momentum_breaker_until ?? null);
      const breakerActive = t.momentumBreaker
        ? true
        : (p.momentum_breaker_active && p.momentum_breaker_until != null && Date.now() < new Date(p.momentum_breaker_until).getTime());

      await db.from('players').update({
        current_price:             t.blendedPrice,
        previous_price:            prev,
        price_change_24h:          parseFloat(change24h.toFixed(2)),
        price_change_pct_24h:      parseFloat(changePct24h.toFixed(2)),
        fair_value:                t.fairValue,
        expected_final_value:      t.fairValue,
        expected_value:            t.evScore,
        twap_price:                t.twap,
        twap_30m:                  t.twap,
        volatility:                t.volatility,
        market_depth:              t.marketDepth,
        volume_24h:                vol24h,
        blend_w_amm:               t.weights.wAmm,
        blend_w_fv:                t.weights.wFv,
        blend_w_twap:              t.weights.wTwap,
        pool_x:                    t.newPoolX,
        pool_y:                    t.newPoolY,
        momentum_breaker_active:   breakerActive,
        momentum_breaker_until:    breakerUntil,
        updated_at:                now,
      }).eq('id', p.id);

      inserts.push({
        player_id:      p.id,
        price:          t.blendedPrice,
        expected_value: t.evScore,
        volatility:     t.volatility,
        created_at:     now,
      });
    }

    if (inserts.length) await db.from('price_history').insert(inserts);

    // ── Process pending orders at this tick's prices ──────────────────────────
    // Orders placed via /api/trade are queued and filled here at current market
    // prices — "fill at next mark". Closes the stat-sync front-running window.
    const orders = await processPendingOrders();

    // ── Prune history older than 7 days (probabilistic — ~1% of ticks) ──────
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await db.from('price_history').delete().lt('created_at', cutoff);
    }

    return NextResponse.json({ success: true, ticks: players.length, orders, timestamp: now });
  } catch (e: any) {
    console.error('Tick error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
