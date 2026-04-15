// ============================================================
// LAKSH v3 — Trading Engine
//
// Pipeline (buy):
//   1. Rate limit (10 trades/min per user, global)
//   2. Anti-manipulation gate (v2):
//      a. Momentum circuit breaker — blocks buys only
//      b. Velocity throttle — max 3 trades/5min per player
//      c. Wash trade detection — 30-min window
//      d. Decayed pressure fill penalty
//      e. Position concentration cap (10% of outstanding shares)
//   3. AMM trade via pricing-v3 (quadratic slippage, tight circuit breaker)
//   4. Dynamic fee applied to effective price
//   5. Atomic balance update (optimistic concurrency)
//   6. Position + trade record
//   7. Pool sync, last_trade_at, volume_24h update
//
// Pipeline (sell): same except steps 2a and 2e are skipped.
//
// Settlement uses 80% FV + 20% 24h-TWAP (oracle-dominant).
// ============================================================

import { TradeRequest } from '@/types';
import { TRADE, SEASON, POOL } from '@/config/constants';
import {
  computeAMMTrade,
  computeFairValue,
  computeMarketDepth,
  computeSettlementPrice,
  computeTWAP,
  computeVol,
  hoursToSettlement,
} from './pricing-v3';
import { checkTradeGate } from './anti-manipulation-v2';
import { serverSupa } from './supabase';

const EPSILON              = 1e-6;
const RATE_LIMIT_TRADES    = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function snap(qty: number): number {
  const n = Number(qty.toFixed(6));
  return Math.abs(n) < EPSILON ? 0 : n;
}

// ─── Buy ──────────────────────────────────────────────────────────────────────
async function executeBuy(userId: string, req: TradeRequest, ip: string | null = null) {
  const db = serverSupa();

  // 1. User record
  let { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) {
    // User may not exist yet if the /api/auth upsert failed at signup.
    // ignoreDuplicates=true: if two concurrent first-trades race here, the
    // second upsert is a no-op and the SELECT below finds the first's row.
    await db.from('users').upsert(
      { id: userId, email: 'unknown@laksh.exchange', display_name: 'Trader',
        balance: TRADE.initial_balance, initial_balance: TRADE.initial_balance },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    const { data: refetched } = await db.from('users').select('*').eq('id', userId).single();
    if (!refetched) return { success: false, error: 'User account not found. Please sign out and back in.' };
    user = refetched;
  }
  const bal = Number(user.balance);

  // 2. Global rate limit
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await db
    .from('trades').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', windowStart);
  if ((recentCount ?? 0) >= RATE_LIMIT_TRADES)
    return { success: false, error: `Rate limit: max ${RATE_LIMIT_TRADES} trades per minute` };

  // 3. Player
  const { data: player } = await db.from('players').select('*').eq('id', req.player_id).single();
  if (!player) return { success: false, error: 'Player not found' };
  if (player.settlement_status === 'settled')
    return { success: false, error: 'This player has already settled — trading is closed' };

  // 4. Validate amount
  const dollars = req.dollars;
  if (dollars > TRADE.max_amount) return { success: false, error: `Max trade $${TRADE.max_amount}` };
  if (dollars < TRADE.min_amount) return { success: false, error: `Min trade $${TRADE.min_amount}` };
  if (dollars > bal) return { success: false, error: `Insufficient funds. Need $${dollars.toFixed(2)}, have $${bal.toFixed(2)}` };

  // 5. Pricing inputs
  const poolX  = Number(player.pool_x);
  const poolY  = Number(player.pool_y);
  const fv     = computeFairValue(player);
  const vol24h = Number(player.volume_24h ?? 0);
  const depth  = computeMarketDepth(player, fv, vol24h);
  const hts    = hoursToSettlement();

  // 6. AMM computation — needed for shares estimate before gate
  const vol      = Number(player.volatility ?? 0.03);
  const ammPre   = computeAMMTrade(poolX, poolY, dollars, 'buy', fv, depth, hts, vol);
  if (ammPre.blocked) return { success: false, error: ammPre.blockReason };
  const sharesEstimate = snap(ammPre.qty);
  if (sharesEstimate <= 0) return { success: false, error: 'Trade amount too small' };

  // 7. Anti-manipulation gate (v2)
  const momentumActive =
    player.momentum_breaker_active &&
    player.momentum_breaker_until != null &&
    Date.now() < new Date(player.momentum_breaker_until).getTime();

  const gate = await checkTradeGate(
    db, userId, req.player_id, 'buy',
    sharesEstimate, Number(player.current_price), momentumActive, ip,
  );
  if (!gate.allowed) return { success: false, error: gate.reason };

  // 8. Apply fill penalty (worse fill for directional attackers)
  // Penalty is applied AFTER the AMM so the penalty doesn't affect pool state —
  // only the effective cost-basis recorded for the user increases.
  const penaltyMult  = gate.fillPenalty;
  const feeRate      = ammPre.feeRate;
  const sharesActual = snap(sharesEstimate / penaltyMult); // fewer shares for same dollars
  const effPrice     = sharesActual > 0 ? dollars / sharesActual : ammPre.effectivePrice * penaltyMult;

  const newBal = parseFloat((bal - dollars).toFixed(2));

  // 9. Position
  const { data: pos } = await db.from('positions').select('*')
    .eq('user_id', userId).eq('player_id', req.player_id).maybeSingle();
  const oldShares   = pos ? snap(Number(pos.shares_owned)) : 0;
  const oldAvg      = pos ? Number(pos.avg_cost_basis) : 0;
  const oldRealized = pos ? Number(pos.realized_pnl) : 0;

  const newShares = snap(oldShares + sharesActual);
  const newAvg    = oldShares > 0
    ? (oldShares * oldAvg + sharesActual * effPrice) / newShares
    : effPrice;

  // 10. Atomic balance update
  const { data: updatedUser } = await db.from('users')
    .update({ balance: newBal, updated_at: new Date().toISOString() })
    .eq('id', userId).eq('balance', parseFloat(bal.toFixed(2)))
    .select('balance').single();
  if (!updatedUser) return { success: false, error: 'Trade conflict — please retry' };

  // 11. Position upsert
  await db.from('positions').upsert(
    { user_id: userId, player_id: req.player_id, shares_owned: newShares,
      avg_cost_basis: parseFloat(newAvg.toFixed(4)), realized_pnl: oldRealized,
      updated_at: new Date().toISOString() },
    { onConflict: 'user_id,player_id' },
  );

  // 12. Trade record (include IP for sybil audit trail)
  const feeCharged = parseFloat((dollars * feeRate).toFixed(4));
  const { data: trade } = await db.from('trades').insert({
    user_id: userId, player_id: req.player_id, side: 'buy',
    shares: sharesActual,
    price: parseFloat(effPrice.toFixed(4)),
    total_value: parseFloat(dollars.toFixed(2)),
    fee_rate: parseFloat(feeRate.toFixed(6)),
    fee_charged: feeCharged,
    realized_pnl: 0,
    ...(ip ? { trade_ip: ip } : {}),
  }).select().single();

  // Update last_trade_ip on user for sybil tracking
  if (ip) {
    await db.from('users').update({ last_trade_ip: ip }).eq('id', userId);
  }

  // 13. Sync AMM pools + derived fields — CAS on pool_x to prevent race condition
  // If another trade executed between our read and write, pool_x will have changed.
  // The update matches no rows → trade conflict, user retries with fresh price.
  const newSpot = ammPre.newPoolX > 0
    ? parseFloat((ammPre.newPoolY / ammPre.newPoolX).toFixed(2))
    : Number(player.current_price);

  const { data: poolUpdated } = await db.from('players').update({
    pool_x:        parseFloat(ammPre.newPoolX.toFixed(6)),
    pool_y:        parseFloat(ammPre.newPoolY.toFixed(4)),
    current_price: newSpot,
    last_trade_at: new Date().toISOString(),
    last_fee_rate: feeRate,
    updated_at:    new Date().toISOString(),
  }).eq('id', req.player_id)
    .eq('pool_x', parseFloat(poolX.toFixed(6)))  // CAS: reject if pool changed
    .select('id').single();

  if (!poolUpdated) {
    // Roll back the balance deduction — re-credit the user
    await db.from('users').update({ balance: bal, updated_at: new Date().toISOString() })
      .eq('id', userId);
    await db.from('trades').delete().eq('id', (trade as any)?.id);
    await db.from('positions').update({ shares_owned: oldShares, avg_cost_basis: oldAvg, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('player_id', req.player_id);
    return { success: false, error: 'Price moved during trade — please retry' };
  }

  console.log(`BUY user=${userId} shares=${sharesActual.toFixed(6)} effPrice=${effPrice.toFixed(2)} fee=${(feeRate*100).toFixed(2)}% penalty=${((penaltyMult-1)*100).toFixed(1)}% newBal=${newBal}`);
  return {
    success: true,
    trade,
    new_balance: newBal,
    fill_penalty_pct: parseFloat(((penaltyMult - 1) * 100).toFixed(1)),
    fee_pct: parseFloat((feeRate * 100).toFixed(2)),
  };
}

// ─── Sell ─────────────────────────────────────────────────────────────────────
async function executeSell(userId: string, req: TradeRequest, ip: string | null = null) {
  const db = serverSupa();

  // 1. User
  let { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) return { success: false, error: 'User not found' };
  const bal = Number(user.balance);

  // 2. Rate limit
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await db
    .from('trades').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', windowStart);
  if ((recentCount ?? 0) >= RATE_LIMIT_TRADES)
    return { success: false, error: `Rate limit: max ${RATE_LIMIT_TRADES} trades per minute` };

  // 3. Player
  const { data: player } = await db.from('players').select('*').eq('id', req.player_id).single();
  if (!player) return { success: false, error: 'Player not found' };
  if (player.settlement_status === 'settled')
    return { success: false, error: 'This player has already settled — trading is closed' };

  const poolX  = Number(player.pool_x);
  const poolY  = Number(player.pool_y);
  const spot   = poolY > 0 && poolX > 0 ? poolY / poolX : Number(player.current_price);
  const fv     = computeFairValue(player);
  const vol24h = Number(player.volume_24h ?? 0);
  const depth  = computeMarketDepth(player, fv, vol24h);
  const hts    = hoursToSettlement();
  const vol    = Number(player.volatility ?? 0.03);

  // 4. Position check
  const { data: pos } = await db.from('positions').select('*')
    .eq('user_id', userId).eq('player_id', req.player_id).maybeSingle();
  const sharesOwned = pos ? snap(Number(pos.shares_owned)) : 0;
  const avgCost     = pos ? Number(pos.avg_cost_basis) : 0;
  const oldRealized = pos ? Number(pos.realized_pnl) : 0;

  if (sharesOwned <= 0) return { success: false, error: 'You have no shares in this player to sell' };

  // 5. Anti-manipulation gate — sells skip momentum breaker and concentration check
  const gate = await checkTradeGate(
    db, userId, req.player_id, 'sell',
    0,   // sharesToBuy irrelevant for sells
    spot,
    false, // momentumTriggered — never blocks sells
  );
  if (!gate.allowed) return { success: false, error: gate.reason };

  let actualSold: number, effPrice: number, usdOut: number, proceeds: number;
  let ammNewX: number, ammNewY: number, feeRate: number;

  if (req.sell_all) {
    // Route through computeAMMTrade for consistent slippage + circuit breaker
    const notional = sharesOwned * spot;
    const amm = computeAMMTrade(poolX, poolY, notional, 'sell', fv, depth, hts, vol);
    if (amm.blocked) return { success: false, error: amm.blockReason };

    feeRate    = amm.feeRate;
    actualSold = sharesOwned; // sell exactly what's owned — amm.qty can differ by rounding
    if (actualSold <= 0) return { success: false, error: 'No shares to sell' };

    // Penalty divides the price received (symmetric: buy penalty multiplies cost)
    effPrice  = amm.effectivePrice / gate.fillPenalty;
    usdOut    = effPrice * actualSold;
    ammNewX   = amm.newPoolX;
    ammNewY   = amm.newPoolY;
    const fee = usdOut * feeRate;
    proceeds  = parseFloat(Math.max(0, usdOut - fee).toFixed(2));

  } else {
    const dollars = req.dollars;
    if (dollars < TRADE.min_amount) return { success: false, error: `Min trade $${TRADE.min_amount}` };

    const amm = computeAMMTrade(poolX, poolY, dollars, 'sell', fv, depth, hts, vol);
    if (amm.blocked) return { success: false, error: amm.blockReason };

    feeRate            = amm.feeRate;
    const sharesToSell = snap(amm.qty);
    if (sharesToSell <= 0) return { success: false, error: 'Trade amount too small' };

    if (sharesToSell > sharesOwned + EPSILON) {
      return {
        success: false,
        error: `Insufficient shares. You own ${sharesOwned.toFixed(4)} shares (≈$${(sharesOwned * spot).toFixed(2)}).`,
      };
    }

    actualSold = Math.min(sharesToSell, sharesOwned);
    // Penalty divides the price received (symmetric: buy penalty multiplies cost)
    effPrice   = amm.effectivePrice / gate.fillPenalty;
    usdOut     = effPrice * actualSold;
    // Fee on actual proceeds, not on requested notional
    const fee  = usdOut * feeRate;
    proceeds   = parseFloat(Math.max(0, usdOut - fee).toFixed(2));
    ammNewX    = amm.newPoolX;
    ammNewY    = amm.newPoolY;
  }

  // 6. Realized P&L
  const realizedPnl = parseFloat(((effPrice - avgCost) * actualSold).toFixed(2));
  const newRealized = parseFloat((oldRealized + realizedPnl).toFixed(2));
  const newBal      = parseFloat((bal + Math.max(0, proceeds)).toFixed(2));
  const newShares   = snap(sharesOwned - actualSold);

  // 7. Atomic balance update
  const { data: updatedUser } = await db.from('users')
    .update({ balance: newBal, updated_at: new Date().toISOString() })
    .eq('id', userId).eq('balance', parseFloat(bal.toFixed(2)))
    .select('balance').single();
  if (!updatedUser) return { success: false, error: 'Trade conflict — please retry' };

  // 8. Position update
  if (newShares <= 0) {
    await db.from('positions').delete().eq('user_id', userId).eq('player_id', req.player_id);
  } else {
    await db.from('positions').update({
      shares_owned: newShares,
      avg_cost_basis: parseFloat(avgCost.toFixed(4)),
      realized_pnl: newRealized,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('player_id', req.player_id);
  }

  // 9. Trade record
  const sellFeeCharged = parseFloat((usdOut * feeRate).toFixed(4));
  const { data: trade } = await db.from('trades').insert({
    user_id: userId, player_id: req.player_id, side: 'sell',
    shares: actualSold,
    price: parseFloat(effPrice.toFixed(4)),
    total_value: parseFloat(usdOut.toFixed(2)),
    fee_rate: parseFloat(feeRate.toFixed(6)),
    fee_charged: sellFeeCharged,
    realized_pnl: realizedPnl,
    ...(ip ? { trade_ip: ip } : {}),
  }).select().single();

  if (ip) {
    await db.from('users').update({ last_trade_ip: ip }).eq('id', userId);
  }

  // 10. Pool sync — CAS on pool_x to prevent race condition
  const newSpot = ammNewX > 0
    ? parseFloat((ammNewY / ammNewX).toFixed(2))
    : Number(player.current_price);

  const { data: sellPoolUpdated } = await db.from('players').update({
    pool_x:        parseFloat(ammNewX.toFixed(6)),
    pool_y:        parseFloat(ammNewY.toFixed(4)),
    current_price: newSpot,
    last_trade_at: new Date().toISOString(),
    last_fee_rate: feeRate,
    updated_at:    new Date().toISOString(),
  }).eq('id', req.player_id)
    .eq('pool_x', parseFloat(poolX.toFixed(6)))
    .select('id').single();

  if (!sellPoolUpdated) {
    // Roll back in order: balance → position → trade record
    const { error: balErr } = await db.from('users')
      .update({ balance: bal, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (balErr) console.error(`SELL ROLLBACK: balance restore failed user=${userId}`, balErr);

    if (newShares > 0) {
      const { error: posErr } = await db.from('positions')
        .update({ shares_owned: sharesOwned, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('player_id', req.player_id);
      if (posErr) console.error(`SELL ROLLBACK: position restore failed user=${userId} player=${req.player_id}`, posErr);
    } else {
      // Position was deleted — recreate it
      const { error: upsertErr } = await db.from('positions').upsert(
        { user_id: userId, player_id: req.player_id, shares_owned: sharesOwned,
          avg_cost_basis: avgCost, realized_pnl: oldRealized, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,player_id' },
      );
      if (upsertErr) console.error(`SELL ROLLBACK: position recreate failed user=${userId} player=${req.player_id} — SHARES LOST`, upsertErr);
    }

    if ((trade as any)?.id) {
      await db.from('trades').delete().eq('id', (trade as any).id);
    }
    return { success: false, error: 'Price moved during trade — please retry' };
  }

  console.log(`SELL${req.sell_all ? ' ALL' : ''} user=${userId} shares=${actualSold.toFixed(6)} effPrice=${effPrice.toFixed(2)} pnl=${realizedPnl.toFixed(2)} newBal=${newBal}`);
  return { success: true, trade, new_balance: newBal, realized_pnl: realizedPnl };
}

// ─── Pending order processor ─────────────────────────────────────────────────
// Called by the price tick every 5s. Fills all pending orders at current
// market prices. Orders expire after 30s if not processed (e.g. server restart).
export async function processPendingOrders(): Promise<{ filled: number; expired: number; failed: number }> {
  const db = serverSupa();
  const now = new Date().toISOString();

  // Expire stale orders first
  await db
    .from('pending_orders')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', now);

  // Fetch all still-pending orders, oldest first
  const { data: orders } = await db
    .from('pending_orders')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50);

  if (!orders?.length) return { filled: 0, expired: 0, failed: 0 };

  let filled = 0, failed = 0;

  for (const order of orders) {
    const req: TradeRequest = {
      player_id: order.player_id,
      side:      order.side as 'buy' | 'sell',
      dollars:   Number(order.dollars),
      sell_all:  order.sell_all,
    };

    if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
      await db.from('pending_orders').update({ status: 'failed', error_message: 'Season settled' }).eq('id', order.id);
      failed++;
      continue;
    }

    try {
      const result = order.side === 'buy'
        ? await executeBuy(order.user_id, req, order.trade_ip)
        : await executeSell(order.user_id, req, order.trade_ip);

      if (result.success) {
        const trade = (result as any).trade;
        await db.from('pending_orders').update({
          status:     'filled',
          fill_price: (result as any).fill_price ?? trade?.price ?? null,
          fill_shares: (result as any).fill_shares ?? trade?.shares ?? null,
          filled_at:  new Date().toISOString(),
        }).eq('id', order.id);
        filled++;
      } else {
        await db.from('pending_orders').update({
          status:        'failed',
          error_message: result.error ?? 'Unknown error',
        }).eq('id', order.id);
        failed++;
      }
    } catch (e: any) {
      await db.from('pending_orders').update({
        status:        'failed',
        error_message: e.message ?? 'Internal error',
      }).eq('id', order.id);
      failed++;
    }
  }

  if (filled || failed) {
    console.log(`PENDING ORDERS: filled=${filled} failed=${failed}`);
  }

  return { filled, expired: 0, failed };
}

// ─── Public executor ─────────────────────────────────────────────────────────
export async function executeTrade(userId: string, req: TradeRequest, ip: string | null = null) {
  if (Date.now() >= new Date(SEASON.settlement_date).getTime())
    return { success: false, error: 'Season has settled — trading is closed.' };
  try {
    if (req.side === 'buy')  return await executeBuy(userId, req, ip);
    if (req.side === 'sell') return await executeSell(userId, req, ip);
    return { success: false, error: 'Invalid side — must be buy or sell' };
  } catch (e: any) {
    console.error('TRADE ERR:', e);
    return { success: false, error: 'An internal error occurred. Please try again.' };
  }
}

// ─── Season Settlement (Parimutuel v4) ───────────────────────────────────────
//
// PARIMUTUEL MODEL — eliminates insolvency risk:
//
//   1. Compute settlement price for every active player (unchanged: 80% FV + 20% TWAP).
//   2. For every user, compute portfolio mark-to-market value:
//        MTM = cash_balance + Σ(shares_i × settlement_price_i)
//   3. Sum MTM across ALL users → total_mtm.
//   4. Load distribution_pool from season_pool table.
//   5. Each user receives:
//        payout = (user_mtm / total_mtm) × distribution_pool
//   6. User's balance is set to their payout. All positions are deleted.
//
// This guarantees: sum of all payouts == distribution_pool (no money created).
// High-performers receive more; poor performers receive less — but nobody can
// "print" money by buying a player whose price was pushed up artificially,
// because the pool is fixed and everyone is paid from the same pot.
//
// Distributed lock ensures this runs exactly once even under concurrent load.
export async function runSettlement() {
  const db = serverSupa();

  // ── Atomic claim ─────────────────────────────────────────────────────────────
  const { data: claimed, error: lockErr } = await db.rpc('claim_settlement');
  if (lockErr || !claimed) {
    const { count: remaining } = await db
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('settlement_status', 'active');
    if (!remaining) {
      console.log('Settlement already complete — skipping');
      return { settled_players: 0, settled_users: 0 };
    }
    console.log(`Settlement lock held but ${remaining} players unsettled — resuming`);
  }

  const { data: players } = await db.from('players').select('*').eq('settlement_status', 'active');
  if (!players?.length) return { settled_players: 0, settled_users: 0 };

  // ── Phase 1: compute settlement price for every player ───────────────────────
  const settlementPriceMap: Record<string, number> = {};
  const failedPlayers: string[] = [];
  let settledPlayers = 0;

  for (const player of players) {
    try {
      const { data: history } = await db
        .from('price_history')
        .select('*')
        .eq('player_id', player.id)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      const hist = (history ?? []).map((h: any) => ({ ...h, price: Number(h.price) }));
      const fv   = computeFairValue(player);
      settlementPriceMap[player.id] = computeSettlementPrice(fv, hist);
    } catch (e: any) {
      console.error(`Failed to compute settlement price for player=${player.id}:`, e.message);
      failedPlayers.push(player.name);
      settlementPriceMap[player.id] = Number(player.current_price); // fallback
    }
  }

  // ── Phase 2: compute every user's portfolio MTM value ───────────────────────
  // Load all positions (all players, all users) and all user balances in bulk.
  const allPlayerIds = players.map((p: any) => p.id);

  const { data: allPositions } = await db
    .from('positions')
    .select('user_id, player_id, shares_owned, avg_cost_basis')
    .in('player_id', allPlayerIds)
    .gt('shares_owned', 0);

  // Group positions by user
  const positionsByUser: Record<string, Array<{ player_id: string; shares: number; avg_cost: number }>> = {};
  for (const pos of allPositions ?? []) {
    if (!positionsByUser[pos.user_id]) positionsByUser[pos.user_id] = [];
    positionsByUser[pos.user_id].push({
      player_id: pos.player_id,
      shares:    snap(Number(pos.shares_owned)),
      avg_cost:  Number(pos.avg_cost_basis),
    });
  }

  // Load all user balances
  const { data: allUsers } = await db
    .from('users')
    .select('id, balance')
    .eq('is_approved', true);

  if (!allUsers?.length) {
    console.error('Settlement: no approved users found');
    return { settled_players: 0, settled_users: 0 };
  }

  // Compute MTM per user
  const userMTM: Record<string, number> = {};
  let totalMTM = 0;

  for (const user of allUsers) {
    const cash      = Number(user.balance);
    const positions = positionsByUser[user.id] ?? [];
    const posValue  = positions.reduce((sum, pos) => {
      const sp = settlementPriceMap[pos.player_id] ?? 0;
      return sum + pos.shares * sp;
    }, 0);

    const mtm = parseFloat((cash + posValue).toFixed(2));
    userMTM[user.id] = mtm;
    totalMTM += mtm;
  }

  // ── Phase 3: load distribution pool ─────────────────────────────────────────
  const { data: poolRow } = await db
    .from('season_pool')
    .select('distribution_pool')
    .eq('season_key', POOL.season_key)
    .single();

  const distributionPool = poolRow ? Number(poolRow.distribution_pool) : totalMTM;

  if (distributionPool <= 0 || totalMTM <= 0) {
    console.error(`Settlement: invalid pool (distribution=${distributionPool}, totalMTM=${totalMTM})`);
    return { settled_players: 0, settled_users: 0 };
  }

  console.log(`SETTLEMENT: distributionPool=$${distributionPool.toFixed(2)}, totalMTM=$${totalMTM.toFixed(2)}, users=${allUsers.length}`);

  // ── Phase 4: pay each user proportionally ───────────────────────────────────
  let settledUsers = 0;
  const payoutLog: Array<{ user_id: string; mtm: number; payout: number }> = [];

  for (const user of allUsers) {
    const mtm    = userMTM[user.id] ?? 0;
    const payout = parseFloat(((mtm / totalMTM) * distributionPool).toFixed(2));

    // CAS retry — balance may be in flight from an in-progress trade
    let credited = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: u } = await db.from('users').select('balance').eq('id', user.id).single();
      if (!u) break;
      const { data: updated } = await db.from('users')
        .update({ balance: payout, updated_at: new Date().toISOString() })
        .eq('id', user.id).eq('balance', parseFloat(Number(u.balance).toFixed(2)))
        .select('balance').single();
      if (updated) { credited = true; break; }
      await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
    }

    if (!credited) {
      console.error(`Settlement payout CAS failed for user=${user.id} — skipping`);
      continue;
    }

    // Record in user_deposits for audit trail
    await db.from('user_deposits').insert({
      user_id:     user.id,
      season_key:  POOL.season_key,
      type:        'settlement',
      gross_amount: mtm,
      fee_charged:  0,
      net_to_pool:  -payout,
      note: `Season settlement: MTM=$${mtm.toFixed(2)}, share=${((mtm/totalMTM)*100).toFixed(2)}%`,
    });

    // Delete all this user's positions (they are now settled)
    const userPositions = positionsByUser[user.id] ?? [];
    for (const pos of userPositions) {
      const sp          = settlementPriceMap[pos.player_id] ?? 0;
      const posProceeds = pos.shares * sp;
      const realizedPnl = (sp - pos.avg_cost) * pos.shares;

      await db.from('trades').insert({
        user_id:      user.id,
        player_id:    pos.player_id,
        side:         'settlement',
        shares:       pos.shares,
        price:        sp,
        total_value:  parseFloat(posProceeds.toFixed(2)),
        realized_pnl: parseFloat(realizedPnl.toFixed(2)),
      });
    }

    if (userPositions.length > 0) {
      await db.from('positions')
        .delete()
        .eq('user_id', user.id)
        .in('player_id', allPlayerIds);
    }

    payoutLog.push({ user_id: user.id, mtm, payout });
    settledUsers++;
  }

  // ── Phase 5: mark all players settled ────────────────────────────────────────
  for (const player of players) {
    const sp = settlementPriceMap[player.id];
    try {
      await db.from('players').update({
        settlement_status:      'settled',
        final_settlement_price: sp,
        updated_at:             new Date().toISOString(),
      }).eq('id', player.id);
      settledPlayers++;
    } catch (e: any) {
      console.error(`Failed to mark player=${player.id} settled:`, e.message);
      if (!failedPlayers.includes(player.name)) failedPlayers.push(player.name);
    }
  }

  // ── Phase 6: mark pool as settled ────────────────────────────────────────────
  await db.from('season_pool').update({
    settled:    true,
    updated_at: new Date().toISOString(),
  }).eq('season_key', POOL.season_key);

  if (failedPlayers.length) {
    console.error(`SETTLEMENT INCOMPLETE: ${failedPlayers.length} players failed: ${failedPlayers.join(', ')}`);
  }
  console.log(`SETTLEMENT (parimutuel) COMPLETE: ${settledPlayers} players, ${settledUsers} users, pool=$${distributionPool.toFixed(2)}`);
  return {
    settled_players: settledPlayers,
    settled_users:   settledUsers,
    failed_players:  failedPlayers,
    distribution_pool: distributionPool,
    total_mtm: totalMTM,
  };
}

// ─── Pool: record initial deposit when user account is created ────────────────
// Called from the auth upsert path so every new user's starting balance
// is reflected in the season pool before their first trade.
export async function recordInitialDeposit(userId: string, amount: number) {
  const db = serverSupa();
  try {
    await db.rpc('record_pool_deposit', {
      p_user_id:    userId,
      p_gross:      amount,
      p_rake_rate:  POOL.rake_rate,
      p_season_key: POOL.season_key,
    });
  } catch (e: any) {
    // Non-fatal: the user account and balance still exist; only pool tracking is missing.
    // Log it so it can be back-filled manually if needed.
    console.warn(`[pool] record_pool_deposit failed for user=${userId}:`, e.message);
  }
}

// ─── Pool: mid-season NAV withdrawal ─────────────────────────────────────────
// User exits early. Their entire portfolio (cash + positions) is liquidated
// at current prices, a 3% exit fee is deducted, and the remainder is paid out.
// The exit fee stays in the pool — it increases proportional payouts for
// everyone who stays until settlement.
export async function executePoolWithdrawal(userId: string) {
  const db = serverSupa();

  // 1. Load user and all their positions
  const { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) return { success: false, error: 'User not found' };

  const { data: positions } = await db.from('positions')
    .select('*, players(current_price, settlement_status)')
    .eq('user_id', userId)
    .gt('shares_owned', 0);

  // 2. Mark-to-market: cash + position value at current prices
  let positionValue = 0;
  for (const pos of positions ?? []) {
    const price = Number((pos as any).players?.current_price ?? 0);
    const shares = snap(Number(pos.shares_owned));
    positionValue += shares * price;
  }
  const nav = parseFloat((Number(user.balance) + positionValue).toFixed(2));
  if (nav <= 0) return { success: false, error: 'Portfolio value is zero — nothing to withdraw' };

  // 3. Calculate exit fee
  const exitFee = parseFloat((nav * POOL.early_exit_fee).toFixed(2));
  const payout  = parseFloat((nav - exitFee).toFixed(2));

  // 4. Record withdrawal in pool (atomic Postgres function)
  const { data: actualPayout, error: poolErr } = await db.rpc('record_pool_withdrawal', {
    p_user_id:    userId,
    p_nav:        nav,
    p_exit_rate:  POOL.early_exit_fee,
    p_season_key: POOL.season_key,
  });
  if (poolErr) return { success: false, error: 'Pool update failed — please retry' };

  // 5. Sell all positions at current price (record trade events for audit trail)
  for (const pos of positions ?? []) {
    const price    = Number((pos as any).players?.current_price ?? 0);
    const shares   = snap(Number(pos.shares_owned));
    const proceeds = shares * price;
    const pnl      = (price - Number(pos.avg_cost_basis)) * shares;

    await db.from('trades').insert({
      user_id:      userId,
      player_id:    pos.player_id,
      side:         'settlement',
      shares,
      price,
      total_value:  parseFloat(proceeds.toFixed(2)),
      realized_pnl: parseFloat(pnl.toFixed(2)),
    });
  }

  // 6. Delete all positions
  if ((positions ?? []).length > 0) {
    await db.from('positions').delete().eq('user_id', userId);
  }

  // 7. Set user balance to payout amount (their cash-out)
  await db.from('users')
    .update({ balance: payout, updated_at: new Date().toISOString() })
    .eq('id', userId);

  console.log(`POOL WITHDRAWAL user=${userId} NAV=${nav.toFixed(2)} fee=${exitFee.toFixed(2)} payout=${payout.toFixed(2)}`);
  return { success: true, nav, exit_fee: exitFee, payout };
}
