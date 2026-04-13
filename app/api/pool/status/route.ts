// GET /api/pool/status
//
// Returns the current season pool stats plus the calling user's
// deposit history and estimated settlement payout.
//
// Used by the UI to show: "If the season ended today, you'd receive $X"

import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
import { POOL } from '@/config/constants';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getApprovedAppUser(req);
  if (!user) return unauth();

  const db = serverSupa();

  // Pool totals
  const { data: pool } = await db
    .from('season_pool')
    .select('*')
    .eq('season_key', POOL.season_key)
    .single();

  // User deposit history
  const { data: deposits } = await db
    .from('user_deposits')
    .select('*')
    .eq('user_id', user.id)
    .eq('season_key', POOL.season_key)
    .order('created_at', { ascending: false });

  // User's current portfolio value (cash + mark-to-market positions)
  const { data: userRow } = await db
    .from('users')
    .select('balance')
    .eq('id', user.id)
    .single();

  const { data: positions } = await db
    .from('positions')
    .select('shares_owned, players(current_price)')
    .eq('user_id', user.id)
    .gt('shares_owned', 0);

  const cash = Number(userRow?.balance ?? 0);
  const posValue = (positions ?? []).reduce((sum: number, pos: any) => {
    return sum + Number(pos.shares_owned) * Number(pos.players?.current_price ?? 0);
  }, 0);
  const portfolioValue = parseFloat((cash + posValue).toFixed(2));

  // Estimated payout if season ended now
  // Requires total MTM across all users — approximate from total deposits and remaining pool
  // For an accurate estimate we'd need to scan all users; use pool math as a proxy.
  const distributionPool = pool ? Number(pool.distribution_pool) : 0;

  // We can't compute exact share without scanning all users.
  // Instead we show the user their absolute performance vs their deposit.
  const totalDeposited = (deposits ?? [])
    .filter((d: any) => d.type === 'deposit')
    .reduce((s: number, d: any) => s + Number(d.gross_amount), 0);

  return NextResponse.json({
    pool: pool
      ? {
          season_key:        pool.season_key,
          total_deposited:   Number(pool.total_deposited),
          rake_collected:    Number(pool.rake_collected),
          early_exit_fees:   Number(pool.early_exit_fees),
          distribution_pool: Number(pool.distribution_pool),
          total_withdrawn:   Number(pool.total_withdrawn),
          settled:           pool.settled,
          rake_rate_pct:     POOL.rake_rate * 100,
          early_exit_fee_pct: POOL.early_exit_fee * 100,
        }
      : null,
    user: {
      portfolio_value:  portfolioValue,
      cash_balance:     cash,
      position_value:   parseFloat(posValue.toFixed(2)),
      total_deposited:  totalDeposited,
      pnl:              parseFloat((portfolioValue - totalDeposited).toFixed(2)),
      pnl_pct:          totalDeposited > 0
        ? parseFloat(((portfolioValue - totalDeposited) / totalDeposited * 100).toFixed(2))
        : 0,
    },
    deposits: deposits ?? [],
  });
}
