// ============================================================
// SECURITY: Endpoint now requires either:
//   - x-cron-secret header (server cron job)
//   - valid user Bearer token (browser client)
// FIX: Pool recalibration on every tick — pool_x/pool_y are
//      updated to keep AMM spot = new current_price, eliminating
//      the tick/trade divergence arbitrage window.
// FIX: Runs runSettlement() instead of ticking after expiry.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { tick } from '@/lib/pricing';
import { checkLiquidations, runSettlement } from '@/lib/trading';
import { getUser } from '@/lib/auth';
import { Player, PricePoint } from '@/types';
import { SEASON } from '@/config/constants';
export const dynamic = 'force-dynamic';

const NF = ['current_price', 'previous_price', 'expected_value', 'volatility', 'ppg', 'apg', 'rpg', 'efficiency', 'pool_x', 'pool_y'];

export async function POST(req: NextRequest) {
  // Auth: accept a signed cron secret (server scheduler) OR a valid user JWT (browser)
  const cronSecret = req.headers.get('x-cron-secret');
  const validCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  if (!validCron) {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Settlement gate: once the season is over, force-close everything instead of ticking
    if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
      const result = await runSettlement();
      return NextResponse.json({ success: true, settled: result.settled, timestamp: new Date().toISOString() });
    }

    const db = serverSupa();
    const { data: players } = await db.from('players').select('*').eq('is_active', true);
    if (!players?.length) return NextResponse.json({ error: 'No players' }, { status: 500 });
    for (const p of players) for (const f of NF) if (p[f] !== undefined) p[f] = Number(p[f]);

    // Fetch recent price history for tick computation
    const { data: allHist } = await db
      .from('price_history')
      .select('*')
      .in('player_id', players.map((p: any) => p.id))
      .order('created_at', { ascending: false })
      .limit(30 * players.length);

    const histories: Record<string, PricePoint[]> = {};
    for (const h of allHist || []) {
      h.price = Number(h.price); h.expected_value = Number(h.expected_value); h.volatility = Number(h.volatility);
      if (!histories[h.player_id]) histories[h.player_id] = [];
      histories[h.player_id].push(h);
    }
    for (const k of Object.keys(histories)) histories[k].reverse();

    // Fetch 24h-ago prices for accurate daily change calculation
    const ago24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: prices24hAgo } = await db
      .from('price_history')
      .select('player_id, price')
      .in('player_id', players.map((p: any) => p.id))
      .lte('created_at', ago24h)
      .order('created_at', { ascending: false })
      .limit(players.length);

    const price24hMap: Record<string, number> = {};
    for (const row of prices24hAgo || []) {
      if (!price24hMap[row.player_id]) price24hMap[row.player_id] = Number(row.price);
    }

    const now = new Date().toISOString();
    const inserts: any[] = [];

    for (const p of players) {
      const t = tick(p as Player, histories[p.id] || []);
      const prev = p.current_price;

      const price24hAgo = price24hMap[p.id] || prev;
      const change24h = t.price - price24hAgo;
      const changePct24h = price24hAgo > 0 ? (change24h / price24hAgo) * 100 : 0;

      // Recalibrate AMM pools to match the new tick price.
      // Preserves k = pool_x * pool_y and sets spot = pool_y / pool_x = t.price.
      // This eliminates the divergence between current_price and AMM spot that
      // previously allowed risk-free arbitrage after idle tick periods.
      const k = p.pool_x * p.pool_y;
      const newPoolX = k > 0 ? Math.sqrt(k / t.price) : p.pool_x;
      const newPoolY = k > 0 ? k / newPoolX : p.pool_y;

      await db.from('players').update({
        current_price: t.price,
        previous_price: prev,
        price_change_24h: parseFloat(change24h.toFixed(2)),
        price_change_pct_24h: parseFloat(changePct24h.toFixed(2)),
        expected_value: t.ev,
        volatility: t.volatility,
        pool_x: parseFloat(newPoolX.toFixed(4)),
        pool_y: parseFloat(newPoolY.toFixed(4)),
        updated_at: now,
      }).eq('id', p.id);

      inserts.push({ player_id: p.id, price: t.price, expected_value: t.ev, volatility: t.volatility, created_at: now });
    }

    if (inserts.length) await db.from('price_history').insert(inserts);

    const liquidated = await checkLiquidations();

    // Prune history older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.from('price_history').delete().lt('created_at', cutoff);

    return NextResponse.json({ success: true, ticks: players.length, liquidations: liquidated.length, timestamp: now });
  } catch (e: any) {
    console.error('Tick error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
