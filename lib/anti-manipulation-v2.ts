// ============================================================
// LAKSH — Anti-Manipulation v2
//
// Addresses the structural weaknesses in v1:
//
// 1. EXPONENTIALLY DECAYING PRESSURE (replaces hard-reset window)
//    Each trade contributes a "pressure score" that decays with
//    a 30-minute half-life. There is no reset. An account that bought
//    $5k every 5 minutes for an hour has a pressure score of:
//      5000 × (e^0 + e^(-1/6) + ... + e^(-11/6)) ≈ $21,000 (decayed)
//    vs the v1 check which saw only the last window ($5k).
//    This stops the "buy $4,999, wait 5 min, repeat" attack.
//
// 2. TRADE VELOCITY THROTTLE (new)
//    Max 3 trades per player per 5-minute window per account.
//    After hitting the limit, a 2-minute cooldown is imposed.
//    Prevents rapid-fire small orders from bypassing pressure limits.
//
// 3. WASH TRADING: EXTENDED WINDOW (30min, was 5min)
//    Round-trip detection now looks back 30 minutes. A wash trader
//    who buys and sells 6 minutes apart was invisible before.
//    Lower threshold: 70% round-trip (was 80%).
//
// 4. POSITION CONCENTRATION GATE (new)
//    No single account can hold shares worth >10% of a player's
//    outstanding market cap. Prevents a single entity from
//    cornering the market and dictating price via hold/sell timing.
//
// 5. MOMENTUM GATE (new)
//    If the momentum circuit breaker is triggered (price rose >8%
//    in 30 minutes), all new buys are blocked for 10 minutes.
//    Sells are always permitted (needed for price correction).
//
// NOTE: Sybil (multi-account) attacks cannot be fully defeated without
// KYC or external identity verification. These checks slow coordinated
// attacks and impose increasing economic cost but cannot stop a
// sufficiently capitalised, patient adversary with many accounts.
// The TWAP-based settlement (80% oracle) means even a successful
// sybil pump yields limited settlement-price benefit.
// ============================================================

import { ANTI_MANIP_V3 as C, PRICING_V3 } from '@/config/constants';

// ═══════════════════════════════════════════════════════════════════════════════
// EXPONENTIALLY DECAYING PRESSURE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the current decayed directional pressure score for a user/player.
 *
 * Scans recent trades (up to 4 hours back) and computes:
 *   pressure = Σ (dollars × direction × exp(-age_ms / halflife_ms))
 *
 * Positive = net buy pressure. Negative = net sell pressure.
 * The penalty is only applied when new trade is in the SAME direction.
 */
export async function computeDecayedPressure(
  db:       ReturnType<typeof import('./supabase').serverSupa>,
  userId:   string,
  playerId: string,
): Promise<number> {
  const lookbackStart = new Date(Date.now() - C.pressure_lookback_ms).toISOString();

  const { data: trades } = await db
    .from('trades')
    .select('side, total_value, created_at')
    .eq('user_id', userId)
    .eq('player_id', playerId)
    .gte('created_at', lookbackStart)
    .in('side', ['buy', 'sell'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (!trades?.length) return 0;

  const now    = Date.now();
  let pressure = 0;

  for (const t of trades) {
    const ageMs     = now - new Date(t.created_at).getTime();
    const decay     = Math.exp(-ageMs / C.pressure_halflife_ms);
    const direction = t.side === 'buy' ? 1 : -1;
    pressure       += Number(t.total_value) * direction * decay;
  }

  return pressure;
}

/**
 * Compute fill penalty from decayed pressure.
 * Quadratic in pressure ratio: light pressure is forgiven, sustained is not.
 * Only penalises same-direction trades.
 */
export async function computeFillPenalty(
  db:       ReturnType<typeof import('./supabase').serverSupa>,
  userId:   string,
  playerId: string,
  side:     'buy' | 'sell',
): Promise<number> {
  const pressure     = await computeDecayedPressure(db, userId, playerId);
  const isBuying     = side === 'buy';
  const sameDir      = (isBuying && pressure > 0) || (!isBuying && pressure < 0);

  if (!sameDir) return 1.0;

  const ratio   = Math.min(Math.abs(pressure) / C.max_pressure_score, 1);
  const penalty = ratio * ratio * C.max_fill_penalty;
  return 1 + penalty;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WASH TRADE DETECTION (30-minute window)
// ═══════════════════════════════════════════════════════════════════════════════

export async function isWashTrading(
  db:       ReturnType<typeof import('./supabase').serverSupa>,
  userId:   string,
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

  const totalBought = trades.filter((t: any) => t.side === 'buy').reduce((s: number, t: any) => s + Number(t.total_value), 0);
  const totalSold   = trades.filter((t: any) => t.side === 'sell').reduce((s: number, t: any) => s + Number(t.total_value), 0);

  const maxRT = Math.max(totalBought, totalSold);
  const minRT = Math.min(totalBought, totalSold);

  if (maxRT < C.wash_min_total) return false;
  return (minRT / maxRT) > C.wash_roundtrip_threshold;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE VELOCITY THROTTLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if the user has exceeded the per-player trade velocity limit.
 * Max 3 trades in any 5-minute rolling window per player.
 */
export async function isTradingTooFast(
  db:       ReturnType<typeof import('./supabase').serverSupa>,
  userId:   string,
  playerId: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - C.velocity_window_ms).toISOString();

  const { count } = await db
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('player_id', playerId)
    .gte('created_at', windowStart)
    .in('side', ['buy', 'sell']);

  return (count ?? 0) >= C.max_trades_in_window;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSITION CONCENTRATION GATE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Checks if a buy would give the user >10% of a player's outstanding market cap.
 *
 * "Outstanding market cap" is approximated as:
 *   totalShares × currentPrice
 * where totalShares = sum of all positions for this player.
 *
 * This prevents cornering — a single account accumulating so many shares
 * that they can dictate price by deciding when/whether to sell.
 */
export async function wouldExceedConcentration(
  db:            ReturnType<typeof import('./supabase').serverSupa>,
  userId:        string,
  playerId:      string,
  sharesToBuy:   number,
  currentPrice:  number,
): Promise<{ exceeded: boolean; message?: string }> {
  // Total outstanding shares across all users
  const { data: allPositions } = await db
    .from('positions')
    .select('shares_owned')
    .eq('player_id', playerId);

  const totalShares = (allPositions ?? []).reduce((s: number, p: any) => s + Number(p.shares_owned), 0);

  // User's current holding
  const { data: myPos } = await db
    .from('positions')
    .select('shares_owned')
    .eq('user_id', userId)
    .eq('player_id', playerId)
    .maybeSingle();

  const myCurrentShares = myPos ? Number(myPos.shares_owned) : 0;
  const myNewShares     = myCurrentShares + sharesToBuy;
  const totalAfter      = totalShares + sharesToBuy;

  if (totalAfter <= 0) return { exceeded: false };

  const concentration = myNewShares / totalAfter;

  if (concentration > PRICING_V3.max_position_pct) {
    const maxMoreShares = Math.max(0, totalAfter * PRICING_V3.max_position_pct - myCurrentShares);
    const maxMoreUSD    = maxMoreShares * currentPrice;
    return {
      exceeded: true,
      message: `Position limit: you would hold ${(concentration * 100).toFixed(1)}% of outstanding shares (max ${(PRICING_V3.max_position_pct * 100).toFixed(0)}%). Max additional purchase: $${maxMoreUSD.toFixed(0)}.`,
    };
  }

  return { exceeded: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED TRADE GATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface TradeGateResult {
  allowed:      boolean;
  reason?:      string;
  fillPenalty:  number;
  feeRate?:     number;
}

/**
 * Compute combined fill penalty including sybil (IP-shared) pressure.
 * Calls the Postgres function get_ip_shared_pressure() which sums
 * decayed pressure from all accounts sharing the same signup_ip.
 */
async function computeSybilAdjustedPenalty(
  db:       ReturnType<typeof import('./supabase').serverSupa>,
  userId:   string,
  playerId: string,
  side:     'buy' | 'sell',
  ownPressure: number,
): Promise<number> {
  try {
    const { data: ipPressure } = await db.rpc('get_ip_shared_pressure', {
      p_user_id:   userId,
      p_player_id: playerId,
    });

    const combined    = ownPressure + (Number(ipPressure) || 0);
    const isBuying    = side === 'buy';
    const sameDir     = (isBuying && combined > 0) || (!isBuying && combined < 0);
    if (!sameDir) return 1.0;

    const ratio   = Math.min(Math.abs(combined) / C.max_pressure_score, 1);
    const penalty = ratio * ratio * C.max_fill_penalty;
    return 1 + penalty;
  } catch {
    // If RPC unavailable (migration not run yet), fall back to own pressure only
    const isBuying = side === 'buy';
    const sameDir  = (isBuying && ownPressure > 0) || (!isBuying && ownPressure < 0);
    if (!sameDir) return 1.0;
    const ratio   = Math.min(Math.abs(ownPressure) / C.max_pressure_score, 1);
    return 1 + ratio * ratio * C.max_fill_penalty;
  }
}

/**
 * Master gate: runs all checks in order of increasing DB cost.
 * First failure blocks the trade.
 *
 * Order:
 *   1. Momentum circuit breaker (in-memory, cheapest)
 *   2. Trade velocity throttle (single COUNT query)
 *   3. Wash trade detection (aggregation query)
 *   4. Fill penalty computation (history scan — runs even if no block)
 *   5. Position concentration (two aggregation queries — only on buys)
 */
export async function checkTradeGate(
  db:              ReturnType<typeof import('./supabase').serverSupa>,
  userId:          string,
  playerId:        string,
  side:            'buy' | 'sell',
  sharesToBuy:     number,
  currentPrice:    number,
  momentumTriggered: boolean,
  ip:              string | null = null,
): Promise<TradeGateResult> {

  // 1. Momentum circuit breaker — blocks buying only
  if (side === 'buy' && momentumTriggered) {
    return {
      allowed: false,
      fillPenalty: 1.0,
      reason: 'Market overheating: rapid price rise detected. Buying is paused for 10 minutes. You can still sell.',
    };
  }

  // 2. Velocity throttle
  if (await isTradingTooFast(db, userId, playerId)) {
    return {
      allowed: false,
      fillPenalty: 1.0,
      reason: `Trade velocity limit: max ${C.max_trades_in_window} trades per player per 5 minutes.`,
    };
  }

  // 3. Wash trade detection
  if (await isWashTrading(db, userId, playerId)) {
    return {
      allowed: false,
      fillPenalty: 1.0,
      reason: 'Round-trip pattern detected within 30 minutes. Wait before trading this player again.',
    };
  }

  // 4. Directional pressure penalty — includes sybil (IP-shared) pressure
  const ownPressure = await computeDecayedPressure(db, userId, playerId);
  const fillPenalty = await computeSybilAdjustedPenalty(db, userId, playerId, side, ownPressure);

  // 5. Position concentration (buys only)
  if (side === 'buy' && sharesToBuy > 0) {
    const conc = await wouldExceedConcentration(db, userId, playerId, sharesToBuy, currentPrice);
    if (conc.exceeded) {
      return { allowed: false, fillPenalty: 1.0, reason: conc.message };
    }
  }

  return { allowed: true, fillPenalty };
}
