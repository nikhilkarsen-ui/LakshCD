// ============================================================
// LAKSH — Anti-Manipulation Layer
//
// Three independent defences, applied in order on every trade:
//
// 1. WASH TRADE DETECTION
//    If a user has bought and sold nearly equal amounts of the
//    same player within a 5-minute window, the trade is blocked.
//    Catches: self-trading to create false volume signals,
//    round-tripping to move price without capital risk.
//
// 2. DIRECTIONAL PRESSURE PENALTY
//    Tracks each user's net buy/sell dollar amount per player
//    over a rolling 5-minute window. Consecutive same-direction
//    trades receive progressively worse fills (up to 8% penalty).
//    Catches: repeated small trades to incrementally pump/dump,
//    coordinated multi-account attacks (partially — per-account).
//
// 3. ORACLE DEVIATION GUARD  (enforced inside computeAMMTrade)
//    If a trade would push price beyond ±30% of fair value,
//    it is blocked entirely. This is a hard circuit breaker.
//    Catches: thin-liquidity flash spikes, pre-settlement attacks.
//
// Note: (3) lives in pricing-v2.ts::computeAMMTrade, not here.
//       This file handles the DB-stateful checks (1) and (2).
// ============================================================

import { ANTI_MANIP as C } from '@/config/constants';

// ═══════════════════════════════════════════════════════════════════════════════
// WASH TRADE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if the user appears to be wash-trading this player.
 *
 * Detection logic: within the last 5 minutes, if
 *   min(totalBought, totalSold) / max(totalBought, totalSold) > 0.80
 * AND total volume > $200, we flag it.
 *
 * Example: bought $1,000, sold $850 → ratio = 0.85 → BLOCKED
 * Example: bought $1,000, sold $200 → ratio = 0.20 → OK (directional, not wash)
 */
export async function isWashTrading(
  db: ReturnType<typeof import('./supabase').serverSupa>,
  userId: string,
  playerId: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - C.wash_window_ms).toISOString();

  const { data: trades } = await db
    .from('trades')
    .select('side, total_value')
    .eq('user_id', userId)
    .eq('player_id', playerId)
    .gte('created_at', windowStart)
    .in('side', ['buy', 'sell']);

  if (!trades?.length) return false;

  const totalBought = trades
    .filter((t: any) => t.side === 'buy')
    .reduce((s: number, t: any) => s + Number(t.total_value), 0);
  const totalSold = trades
    .filter((t: any) => t.side === 'sell')
    .reduce((s: number, t: any) => s + Number(t.total_value), 0);

  const maxRT = Math.max(totalBought, totalSold);
  const minRT = Math.min(totalBought, totalSold);

  if (maxRT < C.wash_min_total) return false;

  return minRT / maxRT > C.wash_roundtrip_threshold;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECTIONAL PRESSURE TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record a trade's dollar amount in the pressure table.
 * Positive = net buy, negative = net sell.
 * Resets when the window expires.
 */
export async function recordPressure(
  db: ReturnType<typeof import('./supabase').serverSupa>,
  userId: string,
  playerId: string,
  dollars: number,
  side: 'buy' | 'sell',
): Promise<void> {
  const signed      = side === 'buy' ? dollars : -dollars;
  const windowStart = new Date(Date.now() - C.pressure_window_ms).toISOString();

  const { data: existing } = await db
    .from('trade_pressure')
    .select('net_buy_dollars, window_start')
    .eq('user_id', userId)
    .eq('player_id', playerId)
    .maybeSingle();

  const isExpired = !existing || new Date(existing.window_start) < new Date(windowStart);

  await db.from('trade_pressure').upsert(
    {
      user_id:          userId,
      player_id:        playerId,
      net_buy_dollars:  isExpired ? signed : Number(existing.net_buy_dollars) + signed,
      window_start:     isExpired ? new Date().toISOString() : existing.window_start,
      updated_at:       new Date().toISOString(),
    },
    { onConflict: 'user_id,player_id' },
  );
}

/**
 * Compute the fill penalty multiplier for a user's next trade.
 *
 * Returns a value ≥ 1.0:
 *   1.00 = no penalty
 *   1.04 = 4% worse fill (price you pay is 4% above market on a buy)
 *   1.08 = 8% worse fill (maximum)
 *
 * Penalty is quadratic in pressure ratio so light pressure barely
 * registers, but sustained one-sided trading hits hard.
 *
 * Only applied when the new trade is in the SAME direction as existing pressure.
 * Selling after buying (position management) is never penalised.
 */
export async function computeFillPenalty(
  db: ReturnType<typeof import('./supabase').serverSupa>,
  userId: string,
  playerId: string,
  side: 'buy' | 'sell',
): Promise<number> {
  const windowStart = new Date(Date.now() - C.pressure_window_ms).toISOString();

  const { data: pressure } = await db
    .from('trade_pressure')
    .select('net_buy_dollars, window_start')
    .eq('user_id', userId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (!pressure || new Date(pressure.window_start) < new Date(windowStart)) return 1.0;

  const netBuy         = Number(pressure.net_buy_dollars);
  const isBuying       = side === 'buy';
  const sameDirection  = (isBuying && netBuy > 0) || (!isBuying && netBuy < 0);

  if (!sameDirection) return 1.0; // directional reversal — no penalty

  // Quadratic penalty: ratio^2 so small pressure is mostly forgiven
  const pressureRatio = Math.min(Math.abs(netBuy) / C.max_pressure_dollars, 1);
  const penalty       = pressureRatio * pressureRatio * C.max_fill_penalty;

  return 1 + penalty;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED TRADE GATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface TradeGateResult {
  allowed:     boolean;
  reason?:     string;
  fillPenalty: number;  // multiplier on effective price (1.0 = no penalty)
}

/**
 * Single entry-point called by the trade executor before any trade.
 * Returns whether the trade is allowed and the fill penalty to apply.
 */
export async function checkTradeGate(
  db: ReturnType<typeof import('./supabase').serverSupa>,
  userId: string,
  playerId: string,
  side: 'buy' | 'sell',
): Promise<TradeGateResult> {
  // Check wash trading first (cheaper DB read, filters most attacks)
  const wash = await isWashTrading(db, userId, playerId);
  if (wash) {
    return {
      allowed:     false,
      reason:      'Trade blocked: round-trip pattern detected. Wait before trading this player again.',
      fillPenalty: 1.0,
    };
  }

  // Compute directional pressure penalty
  const fillPenalty = await computeFillPenalty(db, userId, playerId, side);

  return { allowed: true, fillPenalty };
}
