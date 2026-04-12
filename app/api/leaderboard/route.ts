import { NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = serverSupa();
  const [{ data: users }, { data: allPos }, { data: allTrades }] = await Promise.all([
    db.from('users').select('id, display_name, balance, initial_balance').eq('is_approved', true),
    db.from('positions').select('user_id, shares_owned, player:players(current_price)').gt('shares_owned', 0),
    db.from('trades').select('user_id').in('side', ['buy', 'sell']),
  ]);

  // Holdings = sum(shares_owned * current_price) per user, only non-zero positions
  const holdingsMap: Record<string, number> = {};
  for (const p of (allPos || [])) {
    const shares = Number((p as any).shares_owned);
    const price  = Number((p as any).player?.current_price || 0);
    if (shares > 0 && price > 0) {
      holdingsMap[(p as any).user_id] = (holdingsMap[(p as any).user_id] || 0) + shares * price;
    }
  }

  // Trade count per user — only buy/sell, not settlement
  const tradeCount: Record<string, number> = {};
  for (const t of (allTrades || [])) {
    tradeCount[(t as any).user_id] = (tradeCount[(t as any).user_id] || 0) + 1;
  }

  const allEntries = (users || []).map((u: any) => {
    const cash       = Number(u.balance);
    const init       = Number(u.initial_balance);
    const holdings   = holdingsMap[u.id] || 0;
    const totalValue = cash + holdings;
    const ret        = totalValue - init;
    const trades     = tradeCount[u.id] || 0;
    return {
      user_id:         u.id,
      display_name:    u.display_name || 'Anon',
      portfolio_value: parseFloat(totalValue.toFixed(2)),
      return_usd:      parseFloat(ret.toFixed(2)),
      return_pct:      parseFloat((init > 0 ? (ret / init) * 100 : 0).toFixed(2)),
      num_trades:      trades,
    };
  });

  // Only rank users who have actually traded — untouched accounts at exactly $10k
  // are not competitors, they're just signed up.
  const ranked = allEntries
    .filter(e => e.num_trades > 0)
    .sort((a, b) => {
      // 1. Return % descending
      if (b.return_pct !== a.return_pct) return b.return_pct - a.return_pct;
      // 2. Absolute portfolio value descending (tiebreak: more money = better)
      if (b.portfolio_value !== a.portfolio_value) return b.portfolio_value - a.portfolio_value;
      // 3. More trades = more active (final tiebreak)
      return b.num_trades - a.num_trades;
    });

  return NextResponse.json({
    leaderboard:   ranked.slice(0, 100),
    total_traders: ranked.length,
  });
}
