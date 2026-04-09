// ============================================================
// Futures portfolio accounting
//
// After daily MTM, variation margin has already flowed into
// the cash balance. So total_value uses INTRADAY unrealized P&L
// (current − last_settlement) rather than the full open P&L:
//
//   total_value = cash                        (includes all past MTM flows)
//               + locked_margin_at_entry      (50% of notional at entry price)
//               + intraday_pnl               (current − last_settlement × size)
//
// This equals the pre-MTM formula when last_settlement = avg_entry,
// so it's backwards-compatible for new positions.
//
// total_pnl (display) still shows full P&L since entry:
//   (current − avg_entry) × size
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
import { calcMargin } from '@/lib/trading';
import { MARGIN } from '@/config/constants';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getApprovedAppUser(req);
  if (!authUser) return unauth();
  const db = serverSupa();

  const balance = Number(authUser.balance);
  const initial = Number(authUser.initial_balance);

  const { data: rawPositions, error: posErr } = await db
    .from('positions').select('*, player:players(*)').eq('user_id', authUser.id);
  if (posErr) return NextResponse.json({ error: 'Failed to load positions' }, { status: 500 });

  const positions = (rawPositions || []).filter((p: any) => Math.abs(Number(p.position_size)) > 0.0001);

  let totalIntradayPnl = 0;   // (current − last_settlement) × size — for total_value
  let totalLockedMargin = 0;
  let totalPnlSinceEntry = 0; // (current − avg_entry) × size — for display

  const enriched = positions.map((p: any) => {
    const size = Number(p.position_size);
    const avg = Number(p.avg_entry_price);
    const curPrice = Number(p.player?.current_price || 0);
    const notional = Math.abs(size) * curPrice;

    // Full P&L since entry (for display)
    const pnlSinceEntry = (curPrice - avg) * size;
    const costBasis = Math.abs(size) * avg;
    const pnlPct = costBasis > 0 ? (pnlSinceEntry / costBasis) * 100 : 0;

    // Intraday P&L since last daily settlement (for total_value formula)
    const lastSettle = p.last_settlement_price !== null ? Number(p.last_settlement_price) : avg;
    const intradayPnl = (curPrice - lastSettle) * size;
    const dailyPnlPct = (Math.abs(lastSettle) * Math.abs(size)) > 0
      ? (intradayPnl / (Math.abs(lastSettle) * Math.abs(size))) * 100
      : 0;

    const isLong = size > 0;
    // lockedMargin for DISPLAY: current notional × margin rate
    const lockedMargin = notional * MARGIN.initial;
    // lockedAtEntry: what was actually deducted when position was opened
    const lockedAtEntry = Math.abs(size) * avg * MARGIN.initial;

    totalIntradayPnl += intradayPnl;
    totalLockedMargin += lockedAtEntry;
    totalPnlSinceEntry += pnlSinceEntry;

    // Liquidation price estimate (single-position simplified)
    const maintMargin = notional * MARGIN.maintenance;
    let liqPrice: number;
    if (isLong) {
      liqPrice = Math.max(0, curPrice - (balance - maintMargin) / Math.abs(size));
    } else {
      liqPrice = curPrice + (balance - maintMargin) / Math.abs(size);
    }

    // Coerce player numeric fields
    const player = p.player;
    if (player) {
      for (const f of ['current_price', 'previous_price', 'price_change_24h', 'price_change_pct_24h', 'expected_value', 'volatility', 'ppg', 'apg', 'rpg', 'efficiency']) {
        if (player[f] !== undefined) player[f] = Number(player[f]);
      }
    }

    return {
      ...p,
      position_size: size,
      avg_entry_price: avg,
      last_settlement_price: p.last_settlement_price !== null ? Number(p.last_settlement_price) : null,
      current_price: curPrice,
      notional: parseFloat(notional.toFixed(2)),
      pnl: parseFloat(pnlSinceEntry.toFixed(2)),
      pnl_pct: parseFloat(pnlPct.toFixed(2)),
      daily_pnl: parseFloat(intradayPnl.toFixed(2)),
      daily_pnl_pct: parseFloat(dailyPnlPct.toFixed(2)),
      side: isLong ? 'buy' : 'sell',
      liq_price: parseFloat(Math.max(0, liqPrice).toFixed(2)),
      locked_margin: parseFloat(lockedMargin.toFixed(2)),
      player,
    };
  });

  // Margin status uses equity = cash balance
  const marginPositions = positions.map((p: any) => ({
    size: Number(p.position_size),
    price: Number(p.player?.current_price || 0),
  }));
  const margin = calcMargin(balance, marginPositions);

  // Total portfolio value: cash (includes all settled MTM flows)
  //   + locked_margin_at_entry (what was originally deducted for margin)
  //   + intraday unrealized P&L (since last daily settlement)
  const totalValue = balance + totalLockedMargin + totalIntradayPnl;
  const totalPnl = totalValue - initial;
  const totalPnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;

  // Trades history
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
      positions_value: parseFloat(totalPnlSinceEntry.toFixed(2)),  // total unrealized P&L since entry
      daily_pnl: parseFloat(totalIntradayPnl.toFixed(2)),           // today's variation margin
      total_pnl: parseFloat(totalPnl.toFixed(2)),
      total_pnl_pct: parseFloat(totalPnlPct.toFixed(2)),
      margin,
      positions: enriched,
    },
    trades: coercedTrades,
  });
}
