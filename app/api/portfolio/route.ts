// ============================================================
// Portfolio — spot share ownership accounting
//
// total_value   = cash_balance + holdings_value
// holdings_value = sum(shares_owned * current_price)
// unrealized_pnl = holdings_value - total_cost_basis
// total_pnl     = unrealized_pnl + cumulative_realized_pnl
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

// Module-level cache for total pool value — avoids two full-table scans on every poll.
// Resets on cold start; that's fine since it recomputes within 90s.
let poolTotalCache = { value: 0, at: 0 };

const PLAYER_NUM_FIELDS = ['current_price', 'previous_price', 'price_change_24h', 'price_change_pct_24h', 'expected_value', 'expected_final_value', 'volatility', 'ppg', 'apg', 'rpg', 'efficiency'];

export async function GET(req: NextRequest) {
  const authUser = await getApprovedAppUser(req);
  if (!authUser) return unauth();
  const db = serverSupa();

  const balance = Number(authUser.balance);
  const initial = Number(authUser.initial_balance);

  const { data: rawPositions, error: posErr } = await db
    .from('positions')
    .select('*, player:players(*)')
    .eq('user_id', authUser.id);
  if (posErr) return NextResponse.json({ error: 'Failed to load positions' }, { status: 500 });

  // Filter out zero-share positions (cleanup guard)
  const positions = (rawPositions || []).filter((p: any) => Number(p.shares_owned) > 0.0001);

  let totalHoldingsValue = 0;
  let totalCostBasis = 0;
  let totalRealizedPnl = 0;

  const enriched = positions.map((p: any) => {
    const shares = Number(p.shares_owned);
    const avgCost = Number(p.avg_cost_basis);
    const realized = Number(p.realized_pnl ?? 0);

    const player = p.player;
    if (player) {
      for (const f of PLAYER_NUM_FIELDS) if (player[f] !== undefined) player[f] = Number(player[f]);
    }
    const curPrice = player ? Number(player.current_price) : 0;

    const marketValue = shares * curPrice;
    const costBasis = shares * avgCost;
    const unrealizedPnl = marketValue - costBasis;
    const unrealizedPnlPct = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

    totalHoldingsValue += marketValue;
    totalCostBasis += costBasis;
    totalRealizedPnl += realized;

    return {
      ...p,
      shares_owned: shares,
      avg_cost_basis: avgCost,
      realized_pnl: realized,
      current_price: curPrice,
      market_value: parseFloat(marketValue.toFixed(2)),
      cost_basis: parseFloat(costBasis.toFixed(2)),
      unrealized_pnl: parseFloat(unrealizedPnl.toFixed(2)),
      unrealized_pnl_pct: parseFloat(unrealizedPnlPct.toFixed(2)),
      player,
    };
  });

  const totalUnrealizedPnl = totalHoldingsValue - totalCostBasis;
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;
  const totalValue = balance + totalHoldingsValue;
  const totalPnlPct = initial > 0 ? ((totalValue - initial) / initial) * 100 : 0;

  // Pool share: module-level cache so the two full-table-scan queries don't run
  // on every 15s portfolio poll. Recomputes at most once per 90 seconds.
  let totalAllPortfolios = poolTotalCache.value;
  if (Date.now() - poolTotalCache.at > 90_000) {
    const [{ data: allUsers }, { data: allPos }] = await Promise.all([
      db.from('users').select('id, balance').eq('is_approved', true),
      db.from('positions').select('user_id, shares_owned, player:players(current_price)').gt('shares_owned', 0),
    ]);
    const holdingsMap: Record<string, number> = {};
    for (const p of (allPos || [])) {
      const shares = Number((p as any).shares_owned);
      const price  = Number((p as any).player?.current_price || 0);
      if (shares > 0 && price > 0)
        holdingsMap[(p as any).user_id] = (holdingsMap[(p as any).user_id] || 0) + shares * price;
    }
    totalAllPortfolios = 0;
    for (const u of (allUsers || []))
      totalAllPortfolios += Number(u.balance) + (holdingsMap[u.id] || 0);
    poolTotalCache = { value: totalAllPortfolios, at: Date.now() };
  }
  const RAKE = 0.05;
  const prizePool = totalAllPortfolios * (1 - RAKE);
  const poolSharePct = totalAllPortfolios > 0 ? (totalValue / totalAllPortfolios) * 100 : 0;
  const estimatedPayout = totalAllPortfolios > 0 ? (totalValue / totalAllPortfolios) * prizePool : 0;

  // Trade history
  const { data: trades } = await db
    .from('trades')
    .select('*, player:players(id, name, team)')
    .eq('user_id', authUser.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const coercedTrades = (trades || []).map((t: any) => ({
    ...t,
    shares: Number(t.shares),
    price: Number(t.price),
    total_value: Number(t.total_value),
    realized_pnl: Number(t.realized_pnl ?? 0),
  }));

  return NextResponse.json({
    user: {
      id: authUser.id, email: authUser.email, display_name: authUser.display_name,
      balance, initial_balance: initial,
    },
    portfolio: {
      total_value: parseFloat(totalValue.toFixed(2)),
      cash_balance: balance,
      holdings_value: parseFloat(totalHoldingsValue.toFixed(2)),
      unrealized_pnl: parseFloat(totalUnrealizedPnl.toFixed(2)),
      realized_pnl: parseFloat(totalRealizedPnl.toFixed(2)),
      total_pnl: parseFloat(totalPnl.toFixed(2)),
      total_pnl_pct: parseFloat(totalPnlPct.toFixed(2)),
      pool_share_pct: parseFloat(poolSharePct.toFixed(4)),
      estimated_payout: parseFloat(estimatedPayout.toFixed(2)),
      positions: enriched,
    },
    trades: coercedTrades,
  });
}
