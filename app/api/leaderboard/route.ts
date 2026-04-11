import { NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = serverSupa();
  const { data: users } = await db.from('users').select('id, display_name, balance, initial_balance').eq('is_approved', true);
  const { data: allPos } = await db
    .from('positions')
    .select('user_id, shares_owned, avg_cost_basis, player:players(current_price)');
  const { data: allTrades } = await db.from('trades').select('user_id');

  // Holdings value per user (shares_owned * current_price)
  const holdingsMap: Record<string, number> = {};
  (allPos || []).forEach((p: any) => {
    const shares = Number(p.shares_owned);
    const curPrice = Number(p.player?.current_price || 0);
    holdingsMap[p.user_id] = (holdingsMap[p.user_id] || 0) + shares * curPrice;
  });

  const tradeCount: Record<string, number> = {};
  (allTrades || []).forEach((t: any) => { tradeCount[t.user_id] = (tradeCount[t.user_id] || 0) + 1; });

  const board = (users || []).map((u: any) => {
    const cash = Number(u.balance);
    const init = Number(u.initial_balance);
    const holdings = holdingsMap[u.id] || 0;
    const totalValue = cash + holdings;
    const ret = totalValue - init;
    return {
      user_id: u.id,
      display_name: u.display_name || 'Anon',
      portfolio_value: parseFloat(totalValue.toFixed(2)),
      return_pct: parseFloat((init > 0 ? (ret / init) * 100 : 0).toFixed(2)),
      num_trades: tradeCount[u.id] || 0,
    };
  }).sort((a: any, b: any) => b.return_pct - a.return_pct);

  return NextResponse.json({ leaderboard: board.slice(0, 100), total_traders: board.length });
}
