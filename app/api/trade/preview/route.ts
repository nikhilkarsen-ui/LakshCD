// GET /api/trade/preview?player_id=...&dollars=...&side=buy|sell
//
// Returns a cost breakdown for a trade without executing it.
// Used by the UI to show real fee, shares, and effective price before the user confirms.

import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
import {
  computeAMMTrade,
  computeFairValue,
  computeMarketDepth,
  hoursToSettlement,
} from '@/lib/pricing-v3';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getApprovedAppUser(req);
  if (!user) return unauth();

  const { searchParams } = new URL(req.url);
  const player_id = searchParams.get('player_id');
  const dollars   = parseFloat(searchParams.get('dollars') ?? '0');
  const side      = searchParams.get('side') as 'buy' | 'sell';

  if (!player_id || !dollars || dollars <= 0 || (side !== 'buy' && side !== 'sell')) {
    return NextResponse.json({ error: 'Need player_id, dollars, and side' }, { status: 400 });
  }

  const db = serverSupa();
  const { data: player } = await db.from('players').select('*').eq('id', player_id).single();
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const poolX = Number(player.pool_x);
  const poolY = Number(player.pool_y);
  const fv    = computeFairValue(player);
  const vol24h = Number(player.volume_24h ?? 0);
  const depth = computeMarketDepth(player, fv, vol24h);
  const hts   = hoursToSettlement();
  const vol   = Number(player.volatility ?? 0.03);

  const amm = computeAMMTrade(poolX, poolY, dollars, side, fv, depth, hts, vol);

  if (amm.blocked) {
    return NextResponse.json({ blocked: true, blockReason: amm.blockReason });
  }

  const fee         = parseFloat((dollars * amm.feeRate).toFixed(2));
  const netForShares = parseFloat((dollars - fee).toFixed(2));
  const shares      = parseFloat(amm.qty.toFixed(6));
  // True cost basis per share = total dollars in / shares received
  const costPerShare = shares > 0 ? parseFloat((dollars / shares).toFixed(4)) : 0;
  const marketPrice  = poolY > 0 && poolX > 0 ? parseFloat((poolY / poolX).toFixed(2)) : Number(player.current_price);

  // Check if user has recent directional pressure that would trigger a fill penalty.
  // We don't compute the exact penalty here (that requires the full gate check),
  // but we flag it so the UI can warn the user their actual shares may be slightly fewer.
  const ago5m = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentTrades } = await db
    .from('trades')
    .select('side, total_value')
    .eq('user_id', user.id)
    .eq('player_id', player_id)
    .gte('created_at', ago5m)
    .in('side', ['buy', 'sell']);

  const recentBuyPressure = (recentTrades ?? [])
    .filter((t: any) => t.side === side)
    .reduce((s: number, t: any) => s + Number(t.total_value), 0);

  const fillPenaltyWarning = recentBuyPressure > 1000; // warn if >$1k same-direction in 5 min

  return NextResponse.json({
    blocked:            false,
    shares,
    costPerShare,
    marketPrice,
    fee,
    feeRate:            parseFloat((amm.feeRate * 100).toFixed(2)),
    netForShares,
    slippage:           parseFloat((amm.slippage * 100).toFixed(3)),
    fillPenaltyWarning, // true = you've been trading hard; actual shares may be slightly fewer
  });
}
