// ============================================================
// LAKSH v3 — Trading Engine (Buy/Sell Share Market)
//
// Rules enforced server-side:
//   - BUY: deduct full dollar amount from cash; gain shares
//   - SELL: must own enough shares; gain cash proceeds
//   - shares_owned never goes below zero
//   - no shorting, no margin, no leverage, no liquidation
//   - realized P&L computed on each sell
//   - season-end settlement credits cash for all remaining shares
//
// Security:
//   - Optimistic concurrency lock on balance updates
//   - Rate limit: 10 trades per minute per user
// ============================================================

import { TradeRequest } from '@/types';
import { TRADE, SEASON } from '@/config/constants';
import { computeAMMImpact } from './pricing';
import { serverSupa } from './supabase';

const EPSILON = 1e-6;
const RATE_LIMIT_TRADES = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function snap(qty: number): number {
  const n = Number(qty.toFixed(6));
  return Math.abs(n) < EPSILON ? 0 : n;
}

// ─── Buy ──────────────────────────────────────────────────
// Spends `dollars` of cash to buy shares at AMM price.
// Updates weighted average cost basis.
// ─────────────────────────────────────────────────────────
async function executeBuy(userId: string, req: TradeRequest) {
  const db = serverSupa();

  // 1. User
  let { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) {
    const { data: nu } = await db
      .from('users')
      .insert({ id: userId, email: 'user@laksh.exchange', display_name: 'Trader', balance: TRADE.initial_balance, initial_balance: TRADE.initial_balance })
      .select().single();
    if (!nu) return { success: false, error: 'User not found' };
    user = nu;
  }
  const bal = Number(user.balance);

  // 2. Rate limit
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await db.from('trades').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', windowStart);
  if ((recentCount ?? 0) >= RATE_LIMIT_TRADES) {
    return { success: false, error: `Rate limit: max ${RATE_LIMIT_TRADES} trades per minute` };
  }

  // 3. Player
  const { data: player } = await db.from('players').select('*').eq('id', req.player_id).single();
  if (!player) return { success: false, error: 'Player not found' };
  if (player.settlement_status === 'settled') return { success: false, error: 'This player has already settled — trading is closed' };

  const poolX = Number(player.pool_x), poolY = Number(player.pool_y);

  // 4. Validate amount
  const dollars = req.dollars;
  if (dollars > TRADE.max_amount) return { success: false, error: `Max trade $${TRADE.max_amount}` };
  if (dollars < TRADE.min_amount) return { success: false, error: `Min trade $${TRADE.min_amount}` };
  const fee = dollars * TRADE.fee_rate;
  const netDollars = dollars - fee;
  const totalDeducted = dollars; // full amount leaves cash (fee is part of spend)

  // 5. Sufficient funds
  if (totalDeducted > bal) {
    return { success: false, error: `Insufficient funds. Need $${totalDeducted.toFixed(2)}, have $${bal.toFixed(2)}` };
  }

  // 6. AMM impact
  const amm = computeAMMImpact(poolX, poolY, netDollars, 'buy');
  if (amm.slippage > TRADE.max_slippage) {
    return { success: false, error: `Slippage too high (${(amm.slippage * 100).toFixed(1)}%)` };
  }
  const sharesAcquired = snap(amm.qty);
  if (sharesAcquired <= 0) return { success: false, error: 'Trade amount too small' };

  const effPrice = amm.effectivePrice;
  const newBal = parseFloat((bal - totalDeducted).toFixed(2));

  // 7. Current position
  const { data: pos } = await db.from('positions').select('*').eq('user_id', userId).eq('player_id', req.player_id).maybeSingle();
  const oldShares = pos ? snap(Number(pos.shares_owned)) : 0;
  const oldAvg = pos ? Number(pos.avg_cost_basis) : 0;
  const oldRealized = pos ? Number(pos.realized_pnl) : 0;

  const newShares = snap(oldShares + sharesAcquired);
  // Weighted average cost basis
  const newAvg = oldShares > 0
    ? (oldShares * oldAvg + sharesAcquired * effPrice) / newShares
    : effPrice;

  // 8. Atomic balance update
  const { data: updatedUser } = await db.from('users')
    .update({ balance: newBal, updated_at: new Date().toISOString() })
    .eq('id', userId).eq('balance', parseFloat(bal.toFixed(2)))
    .select('balance').single();
  if (!updatedUser) return { success: false, error: 'Trade conflict — balance changed concurrently, please retry' };

  // 9. Update position
  await db.from('positions').upsert(
    { user_id: userId, player_id: req.player_id, shares_owned: newShares, avg_cost_basis: parseFloat(newAvg.toFixed(2)), realized_pnl: oldRealized, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,player_id' }
  );

  // 10. Record trade
  const { data: trade } = await db.from('trades').insert({
    user_id: userId, player_id: req.player_id, side: 'buy',
    shares: sharesAcquired, price: parseFloat(effPrice.toFixed(2)),
    total_value: parseFloat(dollars.toFixed(2)), realized_pnl: 0,
  }).select().single();

  // 11. Sync AMM pools and current_price
  const newSpot = amm.newX > 0 ? parseFloat((amm.newY / amm.newX).toFixed(2)) : Number(player.current_price);
  await db.from('players').update({
    pool_x: parseFloat(amm.newX.toFixed(4)), pool_y: parseFloat(amm.newY.toFixed(4)),
    current_price: newSpot, updated_at: new Date().toISOString(),
  }).eq('id', req.player_id);

  console.log(`BUY user=${userId} shares=${sharesAcquired.toFixed(6)} effPrice=${effPrice.toFixed(2)} newBal=${newBal}`);
  return { success: true, trade, new_balance: newBal };
}

// ─── Sell ─────────────────────────────────────────────────
// Converts `dollars` notional worth of shares back to cash.
// Validates user owns sufficient shares first.
// Computes realized P&L = (effPrice - avg_cost) * shares_sold.
// ─────────────────────────────────────────────────────────
async function executeSell(userId: string, req: TradeRequest) {
  const db = serverSupa();

  // 1. User
  let { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) return { success: false, error: 'User not found' };
  const bal = Number(user.balance);

  // 2. Rate limit
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await db.from('trades').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', windowStart);
  if ((recentCount ?? 0) >= RATE_LIMIT_TRADES) {
    return { success: false, error: `Rate limit: max ${RATE_LIMIT_TRADES} trades per minute` };
  }

  // 3. Player
  const { data: player } = await db.from('players').select('*').eq('id', req.player_id).single();
  if (!player) return { success: false, error: 'Player not found' };
  if (player.settlement_status === 'settled') return { success: false, error: 'This player has already settled — trading is closed' };

  const poolX = Number(player.pool_x), poolY = Number(player.pool_y);
  const spot = poolY > 0 && poolX > 0 ? poolY / poolX : Number(player.current_price);

  // 4. Current position
  const { data: pos } = await db.from('positions').select('*').eq('user_id', userId).eq('player_id', req.player_id).maybeSingle();
  const sharesOwned = pos ? snap(Number(pos.shares_owned)) : 0;
  const avgCost = pos ? Number(pos.avg_cost_basis) : 0;
  const oldRealized = pos ? Number(pos.realized_pnl) : 0;

  if (sharesOwned <= 0) return { success: false, error: 'You have no shares in this player to sell' };

  // 5. Determine exact shares to sell
  let actualSold: number;
  let effPrice: number;
  let usdOut: number;
  let proceeds: number;
  let ammNewX: number;
  let ammNewY: number;

  if (req.sell_all) {
    // Sell exact shares_owned — bypass dollar→shares rounding entirely
    actualSold = sharesOwned;
    if (actualSold <= 0) return { success: false, error: 'You have no shares to sell' };
    // AMM: tokens flow in, USD flows out. Start from exact token count.
    const k = poolX * poolY;
    if (k <= 0) {
      effPrice = spot;
      usdOut = actualSold * spot;
      ammNewX = poolX + actualSold;
      ammNewY = poolY;
    } else {
      const nX = poolX + actualSold;
      const nY = k / nX;
      usdOut = poolY - nY;
      effPrice = usdOut / actualSold;
      ammNewX = nX;
      ammNewY = nY;
    }
    const fee = usdOut * TRADE.fee_rate;
    proceeds = parseFloat((usdOut - fee).toFixed(2));
  } else {
    const dollars = req.dollars;
    if (dollars < TRADE.min_amount) return { success: false, error: `Min trade $${TRADE.min_amount}` };
    const fee = dollars * TRADE.fee_rate;
    const netDollars = dollars - fee;

    // AMM impact — returns qty = tokensIn (shares to sell)
    const amm = computeAMMImpact(poolX, poolY, netDollars, 'sell');
    const sharesToSell = snap(amm.qty);

    if (sharesToSell <= 0) return { success: false, error: 'Trade amount too small' };

    // Ownership check — cannot sell more than owned
    if (sharesToSell > sharesOwned + EPSILON) {
      const maxSellDollars = sharesOwned * spot;
      return {
        success: false,
        error: `Insufficient shares. You own ${sharesOwned.toFixed(4)} shares (≈$${maxSellDollars.toFixed(2)} at current price). Reduce sell amount.`,
      };
    }

    if (amm.slippage > TRADE.max_slippage) {
      return { success: false, error: `Slippage too high (${(amm.slippage * 100).toFixed(1)}%)` };
    }

    actualSold = Math.min(sharesToSell, sharesOwned);
    effPrice = amm.effectivePrice;
    usdOut = effPrice * actualSold;
    proceeds = parseFloat((usdOut - fee).toFixed(2));
    ammNewX = amm.newX;
    ammNewY = amm.newY;
  }

  // 8. Realized P&L
  const realizedPnl = parseFloat(((effPrice - avgCost) * actualSold).toFixed(2));
  const newRealized = parseFloat((oldRealized + realizedPnl).toFixed(2));

  const newBal = parseFloat((bal + proceeds).toFixed(2));
  const newShares = snap(sharesOwned - actualSold);

  // 9. Atomic balance update
  const { data: updatedUser } = await db.from('users')
    .update({ balance: newBal, updated_at: new Date().toISOString() })
    .eq('id', userId).eq('balance', parseFloat(bal.toFixed(2)))
    .select('balance').single();
  if (!updatedUser) return { success: false, error: 'Trade conflict — balance changed concurrently, please retry' };

  // 10. Update or delete position
  if (newShares <= 0) {
    await db.from('positions').delete().eq('user_id', userId).eq('player_id', req.player_id);
  } else {
    await db.from('positions').update({
      shares_owned: newShares,
      // avg_cost_basis stays the same when selling (FIFO-like; cost basis tracks remaining shares)
      avg_cost_basis: parseFloat(avgCost.toFixed(2)),
      realized_pnl: newRealized,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('player_id', req.player_id);
  }

  // 11. Record trade
  const { data: trade } = await db.from('trades').insert({
    user_id: userId, player_id: req.player_id, side: 'sell',
    shares: actualSold, price: parseFloat(effPrice.toFixed(2)),
    total_value: parseFloat(usdOut.toFixed(2)), realized_pnl: realizedPnl,
  }).select().single();

  // 12. Sync AMM pools and current_price
  const newSpot = ammNewX > 0 ? parseFloat((ammNewY / ammNewX).toFixed(2)) : Number(player.current_price);
  await db.from('players').update({
    pool_x: parseFloat(ammNewX.toFixed(4)), pool_y: parseFloat(ammNewY.toFixed(4)),
    current_price: newSpot, updated_at: new Date().toISOString(),
  }).eq('id', req.player_id);

  console.log(`SELL${req.sell_all ? ' ALL' : ''} user=${userId} shares=${actualSold.toFixed(6)} effPrice=${effPrice.toFixed(2)} pnl=${realizedPnl.toFixed(2)} newBal=${newBal}`);
  return { success: true, trade, new_balance: newBal, realized_pnl: realizedPnl };
}

// ─── Public executor (routes call this) ──────────────────
export async function executeTrade(userId: string, req: TradeRequest) {
  // Season gate: after settlement_date, all positions are auto-settled
  if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
    return { success: false, error: 'Season has settled — trading is closed. All remaining shares will be settled at final price.' };
  }
  try {
    if (req.side === 'buy') return await executeBuy(userId, req);
    if (req.side === 'sell') return await executeSell(userId, req);
    return { success: false, error: 'Invalid side — must be buy or sell' };
  } catch (e: any) {
    console.error('TRADE ERR:', e);
    return { success: false, error: e.message };
  }
}

// ─── Season Settlement ────────────────────────────────────
// Called at season end. Credits each user for remaining shares
// at the player's final_settlement_price (or current_price).
// Idempotent — safe to call multiple times.
// ─────────────────────────────────────────────────────────
export async function runSettlement() {
  const db = serverSupa();

  // Only settle active players
  const { data: players } = await db.from('players').select('*').eq('settlement_status', 'active');
  if (!players?.length) return { settled_players: 0, settled_users: 0 };

  let settledPlayers = 0, settledUsers = 0;

  for (const player of players) {
    const settlementPrice = Number(player.final_settlement_price ?? player.current_price);

    // Mark player as settled
    await db.from('players').update({
      settlement_status: 'settled',
      final_settlement_price: settlementPrice,
      updated_at: new Date().toISOString(),
    }).eq('id', player.id);

    // Find all users holding this player
    const { data: positions } = await db.from('positions').select('*').eq('player_id', player.id).gt('shares_owned', 0);
    if (!positions?.length) { settledPlayers++; continue; }

    for (const pos of positions) {
      const shares = snap(Number(pos.shares_owned));
      if (shares <= 0) continue;

      const proceeds = shares * settlementPrice;
      const realizedPnl = (settlementPrice - Number(pos.avg_cost_basis)) * shares;

      // Credit user cash
      const { data: u } = await db.from('users').select('balance').eq('id', pos.user_id).single();
      if (!u) continue;
      const newBal = parseFloat((Number(u.balance) + proceeds).toFixed(2));

      const { data: updatedUser } = await db.from('users')
        .update({ balance: newBal, updated_at: new Date().toISOString() })
        .eq('id', pos.user_id).eq('balance', parseFloat(Number(u.balance).toFixed(2)))
        .select('balance').single();
      if (!updatedUser) continue; // concurrent call already settled

      // Record settlement trade
      await db.from('trades').insert({
        user_id: pos.user_id, player_id: player.id, side: 'settlement',
        shares, price: settlementPrice,
        total_value: parseFloat(proceeds.toFixed(2)),
        realized_pnl: parseFloat(realizedPnl.toFixed(2)),
      });

      // Zero out position
      await db.from('positions').delete().eq('id', pos.id);
      settledUsers++;
    }

    settledPlayers++;
  }

  console.log(`SETTLEMENT COMPLETE: ${settledPlayers} players, ${settledUsers} user-positions settled`);
  return { settled_players: settledPlayers, settled_users: settledUsers };
}
