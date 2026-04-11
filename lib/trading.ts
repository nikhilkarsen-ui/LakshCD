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
import { TRADE, SEASON } from '@/config/constants';
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
    const { data: nu } = await db
      .from('users')
      .insert({ id: userId, email: 'user@laksh.exchange', display_name: 'Trader', balance: TRADE.initial_balance, initial_balance: TRADE.initial_balance })
      .select().single();
    if (!nu) return { success: false, error: 'User not found' };
    user = nu;
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
  const { data: trade } = await db.from('trades').insert({
    user_id: userId, player_id: req.player_id, side: 'buy',
    shares: sharesActual,
    price: parseFloat(effPrice.toFixed(4)),
    total_value: parseFloat(dollars.toFixed(2)),
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
    actualSold = Math.min(snap(amm.qty), sharesOwned);
    if (actualSold <= 0) return { success: false, error: 'Trade amount too small' };

    effPrice  = amm.effectivePrice * (2 - gate.fillPenalty);
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
    // Fill penalty for sells: reduce effective price received
    effPrice   = amm.effectivePrice * (2 - gate.fillPenalty);
    usdOut     = effPrice * actualSold;
    const fee  = dollars * feeRate;
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
  const { data: trade } = await db.from('trades').insert({
    user_id: userId, player_id: req.player_id, side: 'sell',
    shares: actualSold,
    price: parseFloat(effPrice.toFixed(4)),
    total_value: parseFloat(Math.abs(usdOut ?? proceeds).toFixed(2)),
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
    await db.from('users').update({ balance: bal, updated_at: new Date().toISOString() }).eq('id', userId);
    await db.from('trades').delete().eq('id', (trade as any)?.id);
    if (newShares > 0) {
      await db.from('positions').update({ shares_owned: sharesOwned, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('player_id', req.player_id);
    } else {
      await db.from('positions').upsert(
        { user_id: userId, player_id: req.player_id, shares_owned: sharesOwned, avg_cost_basis: avgCost, realized_pnl: oldRealized, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,player_id' },
      );
    }
    return { success: false, error: 'Price moved during trade — please retry' };
  }

  console.log(`SELL${req.sell_all ? ' ALL' : ''} user=${userId} shares=${actualSold.toFixed(6)} effPrice=${effPrice.toFixed(2)} pnl=${realizedPnl.toFixed(2)} newBal=${newBal}`);
  return { success: true, trade, new_balance: newBal, realized_pnl: realizedPnl };
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
    return { success: false, error: e.message };
  }
}

// ─── Season Settlement (v3) ───────────────────────────────────────────────────
// Settlement = 80% FinalFairValue + 20% TWAP_7day.
// Distributed lock ensures this runs exactly once even under concurrent load.
export async function runSettlement() {
  const db = serverSupa();

  // Atomic claim — only one concurrent caller can proceed
  const { data: claimed, error: lockErr } = await db.rpc('claim_settlement');
  if (lockErr || !claimed) {
    console.log('Settlement already claimed by another process — skipping');
    return { settled_players: 0, settled_users: 0 };
  }

  const { data: players } = await db.from('players').select('*').eq('settlement_status', 'active');
  if (!players?.length) return { settled_players: 0, settled_users: 0 };

  let settledPlayers = 0, settledUsers = 0;

  for (const player of players) {
    // Load 7-day price history for TWAP settlement (7-day window is nearly manipulation-proof)
    const { data: history } = await db
      .from('price_history')
      .select('*')
      .eq('player_id', player.id)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });

    const hist = (history ?? []).map((h: any) => ({ ...h, price: Number(h.price) }));
    const fv   = computeFairValue(player);
    const settlementPrice = computeSettlementPrice(fv, hist);

    await db.from('players').update({
      settlement_status:      'settled',
      final_settlement_price: settlementPrice,
      updated_at:             new Date().toISOString(),
    }).eq('id', player.id);

    const { data: positions } = await db.from('positions')
      .select('*').eq('player_id', player.id).gt('shares_owned', 0);
    if (!positions?.length) { settledPlayers++; continue; }

    for (const pos of positions) {
      const shares = snap(Number(pos.shares_owned));
      if (shares <= 0) continue;

      const proceeds    = shares * settlementPrice;
      const realizedPnl = (settlementPrice - Number(pos.avg_cost_basis)) * shares;

      const { data: u } = await db.from('users').select('balance').eq('id', pos.user_id).single();
      if (!u) continue;

      const newBal = parseFloat((Number(u.balance) + proceeds).toFixed(2));
      const { data: updatedUser } = await db.from('users')
        .update({ balance: newBal, updated_at: new Date().toISOString() })
        .eq('id', pos.user_id).eq('balance', parseFloat(Number(u.balance).toFixed(2)))
        .select('balance').single();
      if (!updatedUser) continue;

      await db.from('trades').insert({
        user_id:      pos.user_id,
        player_id:    player.id,
        side:         'settlement',
        shares,
        price:        settlementPrice,
        total_value:  parseFloat(proceeds.toFixed(2)),
        realized_pnl: parseFloat(realizedPnl.toFixed(2)),
      });

      await db.from('positions').delete().eq('id', pos.id);
      settledUsers++;
    }

    settledPlayers++;
  }

  console.log(`SETTLEMENT v3 COMPLETE: ${settledPlayers} players, ${settledUsers} positions @ 80% FV + 20% TWAP`);
  return { settled_players: settledPlayers, settled_users: settledUsers };
}
