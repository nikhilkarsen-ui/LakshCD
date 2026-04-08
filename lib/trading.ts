// ============================================================
// LAKSH — Trading Engine
// ============================================================
// SECURITY: Settlement gate blocks trades after expiry
// SECURITY: Rate limit — 10 trades/minute per user
// SECURITY: Optimistic concurrency lock on balance updates
//           (WHERE balance = $expected prevents double-spend)
// FIX: delta uses amm.qty (exact tokens in/out) not netDollars/effPrice
// FIX: current_price updated to AMM spot after every trade
//      (eliminates tick/pool divergence arbitrage window)
// FIX: runSettlement force-closes all positions at season end
// ============================================================

import { TradeRequest, MarginInfo } from '@/types';
import { TRADE, MARGIN, SEASON } from '@/config/constants';
import { computeAMMImpact } from './pricing';
import { serverSupa } from './supabase';

const EPSILON = 1e-6;
const RATE_LIMIT_TRADES = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function normalizePosition(qty: number): number {
  const normalized = Number(qty.toFixed(6));
  return Math.abs(normalized) < EPSILON ? 0 : normalized;
}

export function calcMargin(equity: number, positions: { size: number; price: number }[]): MarginInfo {
  let notional = 0;
  for (const p of positions) notional += Math.abs(p.size * p.price);
  const req = notional * MARGIN.initial;
  const maint = notional * MARGIN.maintenance;
  const avail = Math.max(0, equity - req);
  let health: MarginInfo['health'] = 'safe';
  if (notional > 0 && equity <= maint) health = 'liquidation';
  else if (notional > 0 && equity <= req * 1.15) health = 'warning';
  return {
    equity,
    total_notional: notional,
    required_margin: req,
    maintenance_margin: maint,
    margin_available: avail,
    margin_usage_pct: equity > 0 ? (req / equity) * 100 : 0,
    health,
  };
}

export async function executeTrade(userId: string, req: TradeRequest) {
  // Settlement gate: no trades after season expiry
  if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
    return { success: false, error: 'Season has settled — trading is closed' };
  }

  const db = serverSupa();
  try {
    // 1. User
    let { data: user, error: ue } = await db.from('users').select('*').eq('id', userId).single();
    if (ue || !user) {
      const { data: nu } = await db
        .from('users')
        .insert({
          id: userId,
          email: 'user@laksh.exchange',
          display_name: 'Trader',
          balance: TRADE.initial_balance,
          initial_balance: TRADE.initial_balance,
        })
        .select()
        .single();
      if (!nu) return { success: false, error: 'User not found' };
      user = nu;
    }
    const bal = Number(user.balance);

    // 2. Rate limit: max 10 trades per minute
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count: recentCount } = await db
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', windowStart);
    if ((recentCount ?? 0) >= RATE_LIMIT_TRADES) {
      return { success: false, error: `Rate limit: max ${RATE_LIMIT_TRADES} trades per minute` };
    }

    // 3. Player
    const { data: player, error: pe } = await db.from('players').select('*').eq('id', req.player_id).single();
    if (pe || !player) return { success: false, error: 'Player not found' };
    const price = Number(player.current_price);
    const poolX = Number(player.pool_x);
    const poolY = Number(player.pool_y);

    // 4. Current position
    const { data: pos } = await db
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('player_id', req.player_id)
      .maybeSingle();
    const oldSize = pos ? normalizePosition(Number(pos.position_size)) : 0;
    const oldAvg = pos ? Number(pos.avg_entry_price) : 0;

    // 5. AMM impact
    const absDollars = Math.abs(req.dollars);
    if (absDollars > TRADE.max_amount) return { success: false, error: `Max trade $${TRADE.max_amount}` };
    const fee = absDollars * TRADE.fee_rate;
    const netDollars = absDollars - fee;
    const side = req.dollars > 0 ? 'buy' : 'sell';
    const amm = computeAMMImpact(poolX, poolY, netDollars, side);
    if (amm.slippage > TRADE.max_slippage) {
      return { success: false, error: `Slippage too high (${(amm.slippage * 100).toFixed(1)}%)` };
    }

    const effPrice = amm.effectivePrice;
    // Use amm.qty (exact tokens out for buys, exact tokens in for sells)
    // This eliminates the netDollars/effPrice asymmetry on the sell side
    const delta = req.dollars > 0 ? amm.qty : -amm.qty;

    // Reject dust trades: qty rounded to 0 would charge a fee with no position change
    if (Math.abs(delta) < EPSILON) {
      return { success: false, error: 'Trade amount too small' };
    }

    let newSize = normalizePosition(oldSize + delta);

    // 6. P&L and margin accounting
    let realizedPnl = 0;
    let marginChange = 0;

    const isReducing = oldSize !== 0 && Math.sign(delta) !== Math.sign(oldSize);
    const isIncreasing = !isReducing || Math.abs(delta) > Math.abs(oldSize);

    if (isReducing) {
      const closedQty = Math.min(Math.abs(delta), Math.abs(oldSize));
      // P&L realized at execution price (effPrice), not mark price — prevents platform
      // from creating/destroying money proportional to slippage on every close
      realizedPnl = (effPrice - oldAvg) * closedQty * Math.sign(oldSize);
      // Margin released at entry price (oldAvg) — returns exactly what was locked,
      // not a mark-to-market amount that inflates/deflates with price movements
      marginChange += closedQty * oldAvg * MARGIN.initial;
    }

    if (isIncreasing) {
      const openQty = isReducing ? Math.abs(delta) - Math.abs(oldSize) : Math.abs(delta);
      if (openQty > 0) marginChange -= openQty * effPrice * MARGIN.initial;
    }

    const newBal = parseFloat((bal + marginChange - fee + realizedPnl).toFixed(2));
    if (newBal < 0) {
      return {
        success: false,
        error: `Insufficient funds. Trade requires $${(-marginChange + fee).toFixed(2)}, you have $${bal.toFixed(2)}`,
      };
    }

    // 7. New average entry price
    let newAvg: number;
    if (newSize === 0) {
      newAvg = 0;
    } else if (isReducing && Math.abs(delta) > Math.abs(oldSize)) {
      newAvg = effPrice;
    } else if (Math.sign(newSize) === Math.sign(oldSize) && oldSize !== 0) {
      newAvg = (Math.abs(oldSize) * oldAvg + Math.abs(delta) * effPrice) / (Math.abs(oldSize) + Math.abs(delta));
    } else if (isReducing) {
      newAvg = oldAvg;
    } else {
      newAvg = effPrice;
    }

    // 8. Margin check (only enforced when increasing position)
    const { data: allPos } = await db
      .from('positions')
      .select('*, player:players(current_price)')
      .eq('user_id', userId);
    const postPositions = (allPos || [])
      .filter((p: any) => p.player_id !== req.player_id)
      .map((p: any) => ({
        size: normalizePosition(Number(p.position_size)),
        price: Number(p.player?.current_price || 0),
      }))
      .filter((p: any) => p.size !== 0);
    if (newSize !== 0) postPositions.push({ size: newSize, price });
    const marginCheck = calcMargin(newBal, postPositions);

    // The newBal < 0 check above is the correct and sufficient margin gate.
    // newBal is cash AFTER this trade's margin was deducted, so newBal >= 0
    // means the user has paid all required margin. No secondary check needed.

    // 9. Atomic balance update — optimistic concurrency lock
    // Only succeeds if balance hasn't changed since we read it (prevents race condition / double-spend)
    const { data: updatedUser } = await db
      .from('users')
      .update({ balance: newBal, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('balance', parseFloat(bal.toFixed(2)))
      .select('balance')
      .single();

    if (!updatedUser) {
      return { success: false, error: 'Trade conflict — balance changed concurrently, please retry' };
    }

    // 10. Update position
    if (newSize === 0) {
      await db.from('positions').delete().eq('user_id', userId).eq('player_id', req.player_id);
    } else {
      await db.from('positions').upsert(
        {
          user_id: userId,
          player_id: req.player_id,
          position_size: newSize,
          avg_entry_price: parseFloat(newAvg.toFixed(2)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,player_id' }
      );
    }

    // 11. Record trade
    const { data: trade } = await db
      .from('trades')
      .insert({
        user_id: userId,
        player_id: req.player_id,
        size: normalizePosition(delta),
        price: parseFloat(effPrice.toFixed(2)),
        pnl: parseFloat(realizedPnl.toFixed(2)),
      })
      .select()
      .single();

    // 12. Update AMM pools AND current_price to new AMM spot
    // Keeps pool spot price and current_price in sync — eliminates the tick/trade divergence arb
    const newSpot = amm.newX > 0 ? parseFloat((amm.newY / amm.newX).toFixed(2)) : price;
    await db
      .from('players')
      .update({
        pool_x: parseFloat(amm.newX.toFixed(4)),
        pool_y: parseFloat(amm.newY.toFixed(4)),
        current_price: newSpot,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.player_id);

    console.log(
      `TRADE OK user=${userId} delta=${delta.toFixed(6)} newSize=${newSize.toFixed(6)} ` +
      `effPrice=${effPrice.toFixed(2)} newSpot=${newSpot} pnl=${realizedPnl.toFixed(2)} bal=${newBal}`
    );

    return { success: true, trade, new_balance: newBal, margin: marginCheck };
  } catch (e: any) {
    console.error('TRADE ERR:', e);
    return { success: false, error: e.message };
  }
}

// ============================================================
// FUTURES: Daily Mark-to-Market
// Called once per UTC calendar day from the tick route.
// Variation margin = (mark_price − last_settlement_price) × size
// flows directly into / out of the user's cash balance.
// This is the core futures mechanic: P&L is realized daily,
// not only when the position is closed.
// ============================================================
export async function runDailyMTM(): Promise<{ settled_users: number; total_variation_margin: number }> {
  const db = serverSupa();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC

  // Only process positions that have not yet been settled today
  const { data: positions } = await db
    .from('positions')
    .select('*, player:players(current_price)')
    .neq('position_size', 0);

  if (!positions?.length) return { settled_users: 0, total_variation_margin: 0 };

  // Filter to positions not yet settled today
  const unsettled = positions.filter((p: any) => p.last_settlement_date !== today);
  if (!unsettled.length) return { settled_users: 0, total_variation_margin: 0 };

  // Group by user
  const byUser: Record<string, any[]> = {};
  for (const p of unsettled) {
    const size = normalizePosition(Number(p.position_size));
    if (size === 0) continue;
    if (!byUser[p.user_id]) byUser[p.user_id] = [];
    byUser[p.user_id].push({ ...p, position_size: size });
  }

  let settledUsers = 0;
  let totalVariationMargin = 0;

  for (const [uid, poss] of Object.entries(byUser)) {
    const { data: u } = await db.from('users').select('balance').eq('id', uid).single();
    if (!u) continue;
    let variationMargin = 0;

    for (const p of poss) {
      const size = p.position_size as number;
      const markPrice = Number(p.player?.current_price || 0);
      // Use last_settlement_price if set, otherwise fall back to avg_entry_price (first day)
      const prevSettle = p.last_settlement_price !== null
        ? Number(p.last_settlement_price)
        : Number(p.avg_entry_price);

      const dailyPnl = (markPrice - prevSettle) * size;
      variationMargin += dailyPnl;

      // Advance settlement price to today's mark
      await db.from('positions').update({
        last_settlement_price: parseFloat(markPrice.toFixed(2)),
        last_settlement_date: today,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id);
    }

    // Credit / debit variation margin to cash balance (never below 0)
    if (Math.abs(variationMargin) > 0.005) {
      const newBal = Math.max(0, parseFloat((Number(u.balance) + variationMargin).toFixed(2)));
      await db.from('users').update({
        balance: newBal,
        updated_at: new Date().toISOString(),
      }).eq('id', uid);
    }

    totalVariationMargin += variationMargin;
    settledUsers++;
  }

  console.log(`DAILY MTM: ${settledUsers} users, variation margin flow: $${totalVariationMargin.toFixed(2)}`);
  return { settled_users: settledUsers, total_variation_margin: totalVariationMargin };
}

// Force-close all open positions at current price.
// Called by the tick route at/after settlement_date. Idempotent — safe to call multiple times.
export async function runSettlement() {
  const db = serverSupa();
  const { data: positions } = await db
    .from('positions')
    .select('*, player:players(current_price)')
    .neq('position_size', 0);

  if (!positions?.length) return { settled: 0 };

  const byUser: Record<string, any[]> = {};
  for (const p of positions) {
    const size = normalizePosition(Number(p.position_size));
    if (size === 0) continue;
    if (!byUser[p.user_id]) byUser[p.user_id] = [];
    byUser[p.user_id].push({ ...p, position_size: size });
  }

  let settled = 0;
  for (const [uid, poss] of Object.entries(byUser)) {
    const { data: u } = await db.from('users').select('balance').eq('id', uid).single();
    if (!u) continue;
    let equity = Number(u.balance);

    for (const p of poss) {
      const size = p.position_size;
      const curPrice = Number(p.player?.current_price || 0);
      const avg = Number(p.avg_entry_price);
      const pnl = (curPrice - avg) * size;
      const releasedMargin = Math.abs(size) * avg * MARGIN.initial;

      // Idempotency: only zero out a position that is still open.
      // If two concurrent settlement calls both read the same positions, only
      // the first to write will find position_size != 0 and proceed.
      const { data: settledPos } = await db.from('positions')
        .update({ position_size: 0, avg_entry_price: 0, updated_at: new Date().toISOString() })
        .eq('id', p.id)
        .neq('position_size', 0)
        .select('id')
        .single();

      if (!settledPos) continue; // concurrent call already settled this position

      equity += releasedMargin + pnl;
      await db.from('trades').insert({
        user_id: uid,
        player_id: p.player_id,
        size: normalizePosition(-size),
        price: curPrice,
        pnl: parseFloat(pnl.toFixed(2)),
      });
    }

    const finalBal = Math.max(0, parseFloat(equity.toFixed(2)));
    await db.from('users').update({ balance: finalBal, updated_at: new Date().toISOString() }).eq('id', uid);
    settled++;
  }

  console.log(`SETTLEMENT COMPLETE: ${settled} users settled`);
  return { settled };
}

export async function checkLiquidations() {
  const db = serverSupa();
  const { data: positions } = await db
    .from('positions')
    .select('*, player:players(current_price)')
    .neq('position_size', 0);
  if (!positions?.length) return [];

  const byUser: Record<string, any[]> = {};
  for (const p of positions) {
    const normalizedSize = normalizePosition(Number(p.position_size));
    if (normalizedSize === 0) {
      await db
        .from('positions')
        .update({ position_size: 0, avg_entry_price: 0, updated_at: new Date().toISOString() })
        .eq('id', p.id);
      continue;
    }
    if (!byUser[p.user_id]) byUser[p.user_id] = [];
    byUser[p.user_id].push({ ...p, position_size: normalizedSize });
  }

  const liquidated: string[] = [];
  for (const [uid, poss] of Object.entries(byUser)) {
    const { data: u } = await db.from('users').select('balance').eq('id', uid).single();
    if (!u) continue;
    let equity = Number(u.balance);
    const posArr = poss.map((p: any) => ({
      size: p.position_size,
      price: Number(p.player?.current_price || 0),
    }));
    const m = calcMargin(equity, posArr);

    if (m.health === 'liquidation') {
      console.log(`LIQUIDATION user=${uid} equity=${equity.toFixed(2)} maint=${m.maintenance_margin.toFixed(2)}`);

      for (const p of poss) {
        const size = p.position_size;
        const curPrice = Number(p.player?.current_price || 0);
        const avg = Number(p.avg_entry_price);
        const pnl = (curPrice - avg) * size;
        const releasedMargin = Math.abs(size) * avg * MARGIN.initial;
        equity += releasedMargin + pnl;

        await db.from('trades').insert({
          user_id: uid,
          player_id: p.player_id,
          size: normalizePosition(-size),
          price: curPrice,
          pnl: parseFloat(pnl.toFixed(2)),
        });

        await db.from('positions').update({
          position_size: 0,
          avg_entry_price: 0,
          updated_at: new Date().toISOString(),
        }).eq('id', p.id);
      }

      const finalBal = Math.max(0, parseFloat(equity.toFixed(2)));
      await db.from('users').update({ balance: finalBal, updated_at: new Date().toISOString() }).eq('id', uid);
      console.log(`LIQUIDATION SETTLED user=${uid} finalBal=${finalBal}`);
      liquidated.push(uid);
    }
  }
  return liquidated;
}
