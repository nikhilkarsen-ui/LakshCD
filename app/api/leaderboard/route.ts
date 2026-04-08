// FIX: Portfolio value now matches the portfolio route formula:
//   total = cash_balance + locked_margin + unrealized_pnl
// Previously locked_margin was omitted, making active traders rank
// lower than cash-only holders of equal economic value.

import { NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { MARGIN } from '@/config/constants';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = serverSupa();
  const { data: users } = await db.from('users').select('id, display_name, balance, initial_balance');
  const { data: allPos } = await db
    .from('positions')
    .select('user_id, position_size, avg_entry_price, player:players(current_price)');
  const { data: allTrades } = await db.from('trades').select('user_id');

  const unrealizedPnlMap: Record<string, number> = {};
  const lockedMarginMap: Record<string, number> = {};

  (allPos || []).forEach((p: any) => {
    const size = Number(p.position_size);
    const avg = Number(p.avg_entry_price);
    const curPrice = Number(p.player?.current_price || 0);
    const pnl = (curPrice - avg) * size;
    // Use entry-price-based locked margin (what was actually deducted from balance),
    // not mark-to-market, so portfolioVal correctly reflects true economic value
    const lockedAtEntry = Math.abs(size) * avg * MARGIN.initial;
    unrealizedPnlMap[p.user_id] = (unrealizedPnlMap[p.user_id] || 0) + pnl;
    lockedMarginMap[p.user_id] = (lockedMarginMap[p.user_id] || 0) + lockedAtEntry;
  });

  const tradeCount: Record<string, number> = {};
  (allTrades || []).forEach((t: any) => { tradeCount[t.user_id] = (tradeCount[t.user_id] || 0) + 1; });

  const board = (users || []).map((u: any) => {
    const bal = Number(u.balance);
    const init = Number(u.initial_balance);
    const unrealized = unrealizedPnlMap[u.id] || 0;
    const lockedMargin = lockedMarginMap[u.id] || 0;
    // Same formula as portfolio route: cash + locked_margin + unrealized_pnl
    const portfolioVal = bal + lockedMargin + unrealized;
    const ret = portfolioVal - init;
    return {
      user_id: u.id,
      display_name: u.display_name || 'Anon',
      portfolio_value: parseFloat(portfolioVal.toFixed(2)),
      return_pct: parseFloat((init > 0 ? (ret / init) * 100 : 0).toFixed(2)),
      num_trades: tradeCount[u.id] || 0,
    };
  }).sort((a: any, b: any) => b.return_pct - a.return_pct);

  return NextResponse.json({ leaderboard: board.slice(0, 100), total_traders: board.length });
}
