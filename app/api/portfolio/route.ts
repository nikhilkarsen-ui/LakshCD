// ============================================================
// Bug #12 fix: total_value = cash + locked_margin + unrealized_pnl
// Cash is already reduced by locked margin, so:
// total_value = cash + sum(notional * margin_rate) + sum(unrealized_pnl)
//             = cash + sum(margin_held_per_position + pnl_per_position)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
import { calcMargin } from '@/lib/trading';
import { MARGIN } from '@/config/constants';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getUser(req);
  if (!authUser) return unauth();
  const db = serverSupa();

  const { data: user } = await db.from('users').select('*').eq('id', authUser.id).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const balance = Number(user.balance);
  const initial = Number(user.initial_balance);

  const { data: rawPositions, error: posErr } = await db
    .from('positions').select('*, player:players(*)').eq('user_id', authUser.id);
  if (posErr) return NextResponse.json({ error: 'Failed to load positions' }, { status: 500 });

  const positions = (rawPositions || []).filter((p: any) => Math.abs(Number(p.position_size)) > 0.0001);

  // Enrich positions
  let totalUnrealizedPnl = 0;
  let totalLockedMargin = 0;

  const enriched = positions.map((p: any) => {
    const size = Number(p.position_size);
    const avg = Number(p.avg_entry_price);
    const curPrice = Number(p.player?.current_price || 0);
    const notional = Math.abs(size) * curPrice;
    const pnl = (curPrice - avg) * size; // long: profit when price up. short: profit when price down.
    const costBasis = Math.abs(size) * avg;
    const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
    const isLong = size > 0;
    // lockedMargin for DISPLAY uses current notional (mark-to-market requirement shown to user)
    const lockedMargin = notional * MARGIN.initial;
    // lockedAtEntry is what was actually deducted from balance when the position was opened;
    // used for totalValue so it correctly equals initial - fees + realizedPnl + unrealizedPnl
    const lockedAtEntry = Math.abs(size) * avg * MARGIN.initial;

    totalUnrealizedPnl += pnl;
    totalLockedMargin += lockedAtEntry;

    // Liquidation price: when does equity (cash) fall to maintenance_margin for all positions
    // Simplified per-position estimate
    const maintMargin = notional * MARGIN.maintenance;
    let liqPrice: number;
    if (isLong) {
      // Price drop reduces P&L, balance doesn't change (P&L is unrealized)
      // Liquidation when: balance + (liqP - curP) * size = maintenance_margin_total
      // For single position: liqP = curP - (balance - maintMargin) / size
      liqPrice = Math.max(0, curPrice - (balance - maintMargin) / Math.abs(size));
    } else {
      liqPrice = curPrice + (balance - maintMargin) / Math.abs(size);
    }

    // Coerce player fields
    const player = p.player;
    if (player) {
      for (const f of ['current_price', 'previous_price', 'price_change_24h', 'price_change_pct_24h', 'expected_value', 'volatility', 'ppg', 'apg', 'rpg', 'efficiency']) {
        if (player[f] !== undefined) player[f] = Number(player[f]);
      }
    }

    return {
      ...p,
      position_size: size, avg_entry_price: avg,
      current_price: curPrice,
      notional: parseFloat(notional.toFixed(2)),
      pnl: parseFloat(pnl.toFixed(2)),
      pnl_pct: parseFloat(pnlPct.toFixed(2)),
      side: isLong ? 'buy' : 'sell',
      liq_price: parseFloat(Math.max(0, liqPrice).toFixed(2)),
      locked_margin: parseFloat(lockedMargin.toFixed(2)),
      player,
    };
  });

  // Margin status
  const marginPositions = positions.map((p: any) => ({
    size: Number(p.position_size),
    price: Number(p.player?.current_price || 0),
  }));
  const margin = calcMargin(balance, marginPositions);

  // --- Bug #12 fix: total portfolio value ---
  // cash (already reduced by locked margin) + locked margin back + unrealized P&L
  // = what the user would have if they closed everything right now
  const totalValue = balance + totalLockedMargin + totalUnrealizedPnl;
  const totalPnl = totalValue - initial;
  const totalPnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;

  // Trades
  const { data: trades } = await db.from('trades')
    .select('*, player:players(id, name, team)')
    .eq('user_id', authUser.id)
    .order('created_at', { ascending: false }).limit(50);

  const coercedTrades = (trades || []).map((t: any) => ({
    ...t, size: Number(t.size), price: Number(t.price), pnl: Number(t.pnl || 0),
  }));

  return NextResponse.json({
    user: {
      id: user.id, email: user.email, display_name: user.display_name,
      balance, initial_balance: initial,
    },
    portfolio: {
      total_value: parseFloat(totalValue.toFixed(2)),
      cash_balance: balance,
      locked_margin: parseFloat(totalLockedMargin.toFixed(2)),
      positions_value: parseFloat(totalUnrealizedPnl.toFixed(2)),
      total_pnl: parseFloat(totalPnl.toFixed(2)),
      total_pnl_pct: parseFloat(totalPnlPct.toFixed(2)),
      margin,
      positions: enriched,
    },
    trades: coercedTrades,
  });
}
