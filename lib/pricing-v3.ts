// ============================================================
// LAKSH — Pricing Engine v3
//
// Redesigned after adversarial analysis of v2. Key changes:
//
//   AMM weight reduced: 40% → 15% (oracle-dominant)
//   Circuit breaker: ±30% → ±15% (tighter, context-sensitive)
//   Slippage exponent: 1.5 → 2.0 (quadratic, harsher for large trades)
//   Base depth: $40k → $80k (doubles manipulation cost)
//   TWAP window: 5min → 30min (harder to manipulate with short spikes)
//   Settlement uses 24h TWAP of blended prices, not 5min TWAP
//   Volume bonus no longer shifts weight toward AMM (was a backfire)
//   Dynamic fee scales with price deviation from FV
//   Momentum circuit breaker: buying paused if >8% rise in 30min
//   Position concentration cap: no account > 10% of market cap
//
// Price formula (neutral market):
//   blended = 0.15 × AMM_spot + 0.65 × FairValue + 0.20 × TWAP_30min
//
// Settlement price formula:
//   settlement = 0.80 × FinalFairValue + 0.20 × TWAP_24h
//
// The dominant role of FV (65–90% near settlement) means that
// market manipulation cannot meaningfully shift the settlement price
// without also manipulating the underlying stat oracle, which is
// independently sourced from BallDontLie.
// ============================================================

import { Player, PricePoint } from '@/types';
import { PRICING_V3 as C, NO_GAME_PRICING as NG, SEASON } from '@/config/constants';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

export function seasonProgress(): number {
  const start = new Date(SEASON.start_date).getTime();
  const end   = new Date(SEASON.settlement_date).getTime();
  const now   = Date.now();
  if (now <= start) return 0;
  if (now >= end)   return 1;
  return (now - start) / (end - start);
}

export function hoursToSettlement(): number {
  return Math.max(0, (new Date(SEASON.settlement_date).getTime() - Date.now()) / 3_600_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAIR VALUE ORACLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute oracle fair value with Bayesian shrinkage.
 *
 * Key improvement over v2:
 *   - Credibility threshold lowered to 20 games (not 30)
 *   - Player prior comes from stored `prior_fv_score` if available
 *     (seeded from prior-season stats, not league average)
 *   - Games-adjusted projection: uses min(games_played, total_games)
 *     so injured players with few games get FV based on their actual
 *     productive games, not a full 82-game projection.
 *
 * Injury handling:
 *   If games_played << total_games and the season is well-progressed,
 *   we scale the projection by (games_played / expected_games_by_now).
 *   This partially corrects for players who are missing games.
 */
export function computeFairValue(player: Player): number {
  const gp = Math.max(1, Number(player.games_played));

  // Season-pace projection (per-game rate × 82)
  const projPts = Number(player.ppg)        * SEASON.total_games;
  const projAst = Number(player.apg)        * SEASON.total_games;
  const projReb = Number(player.rpg)        * SEASON.total_games;
  const projEff = Number(player.efficiency) * SEASON.total_games;

  const rawScore =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;

  // Games-availability discount: if season is >20% progressed and player
  // has played <50% of expected games, discount FV proportionally.
  // This partially handles injury/absence without needing explicit injury tracking.
  const progress = seasonProgress();
  let availabilityDiscount = 1.0;
  if (progress > 0.20) {
    const expectedGames   = Math.floor(SEASON.total_games * progress);
    const gamesRatio      = Math.min(1, gp / Math.max(1, expectedGames));
    // Discount linearly: if played 50% of expected games, FV = 75% of full-pace FV
    // (0.5 + 0.5 = 1 → full; 0 + 0.5 = 0.5 → half... we use lerp between gamesRatio and 1)
    availabilityDiscount  = 0.5 + 0.5 * gamesRatio;
  }

  // Bayesian shrinkage: prior can be player-specific (from DB) or league average
  const prior       = Number((player as any).prior_fv_score ?? C.league_avg_score);
  const credibility = Math.min(gp / C.credibility_games, 1);
  const shrunkScore = credibility * rawScore + (1 - credibility) * prior;

  const evScore = Math.max(0, Math.min(1000, shrunkScore * 1000 * availabilityDiscount));
  const baseFV  = Math.max(C.min_price, evScore * C.fv_scale);

  // Live game boost (dampened to ±10% in v3)
  const boostActive =
    player.live_boost_expires_at != null &&
    Date.now() < new Date(player.live_boost_expires_at).getTime();
  const boost = boostActive ? Number(player.live_game_boost ?? 0) : 0;

  return parseFloat((baseFV * (1 + boost * C.live_boost_scale)).toFixed(2));
}

export function computeEVScore(player: Player): number {
  const projPts = Number(player.ppg)        * SEASON.total_games;
  const projAst = Number(player.apg)        * SEASON.total_games;
  const projReb = Number(player.rpg)        * SEASON.total_games;
  const projEff = Number(player.efficiency) * SEASON.total_games;
  const raw =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;
  return Math.max(0, Math.min(1000, raw * 1000));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC FEE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the fee rate for a given trade.
 *
 * Fee escalates when:
 *   - Price is away from fair value (trading into uncertainty costs more)
 *   - Volatility is elevated (market stress)
 *   - Side is pushing price further from FV (directional escalation)
 *
 * This creates a natural friction that grows with manipulation attempts:
 * the further you push price from FV, the more each subsequent trade costs.
 * A trader who has already pushed price 10% above FV faces 3× the base fee
 * on their next buy. Sellers pulling price back toward FV pay the base fee.
 *
 * fee = base × (1 + dev_mult × |price/FV - 1|) × (1 + vol_mult × volatility/target)
 * capped at fee_cap (5%)
 */
export function computeDynamicFee(
  currentPrice: number,
  fairValue:    number,
  volatility:   number,
  side:         'buy' | 'sell',
): number {
  const deviation     = (currentPrice - fairValue) / Math.max(fairValue, 1);
  const absDev        = Math.abs(deviation);
  const movingTowardFv = (side === 'sell' && deviation > 0) || (side === 'buy' && deviation < 0);

  // No escalation for trades that move price back toward FV — only penalise divergence
  const devPenalty = movingTowardFv ? 0 : absDev * C.fee_dev_multiplier;
  const volPenalty = Math.max(0, (volatility / C.target_vol - 1)) * C.fee_vol_multiplier * C.fee_rate_base;

  const fee = C.fee_rate_base * (1 + devPenalty) + volPenalty;
  return Math.min(C.fee_cap, parseFloat(fee.toFixed(4)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRTUAL MARKET DEPTH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * v3 depth model — no volume-to-AMM-weight bonus.
 *
 * The v2 model gave a volume bonus that shifted weight toward the AMM,
 * making high-volume periods more manipulable. This is removed.
 *
 * Depth still grows with season maturity and proximity to FV.
 * The sqrt-volume bonus remains for depth (not weight) as it rewards
 * organic liquidity without making the displayed price more AMM-sensitive.
 */
export function computeMarketDepth(
  player:              Player,
  fairValue:           number,
  recentVolume24hUSD:  number,
): number {
  const progress = seasonProgress();

  const maturityDepth = C.base_depth * (1 + progress * C.depth_season_boost);

  const currentPrice  = Number(player.current_price);
  const priceDev      = Math.abs(currentPrice - fairValue) / Math.max(fairValue, 1);
  const proximityMult = 1 + C.depth_proximity_boost * Math.exp(-priceDev / C.depth_proximity_decay);

  // Volume bonus only adds to depth (resistance), not to AMM weight
  const volumeMult = 1 + Math.sqrt(Math.max(0, recentVolume24hUSD) / C.depth_volume_base) * 0.25;

  return Math.max(C.min_depth, maturityDepth * proximityMult * volumeMult);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tighter circuit breaker: ±15% early season → ±4% near settlement.
 *
 * v2 used ±30%, which allowed a player to be manipulated to 130% of FV.
 * At a FV of $300, that's a $90 artificial premium — enormous for retail holders.
 *
 * v3 uses ±15% max (early), linearly tightening to ±4% in the final week.
 * A manipulator can still cause a 15% deviation, but at $300 FV that's
 * only $45 — and it costs dramatically more with the doubled base depth
 * and quadratic slippage.
 */
export function computeCircuitBreaker(hts: number): number {
  const t = Math.min(1, hts / C.settlement_protection_hours);
  // Linear interpolation from floor to base
  return C.max_fv_deviation_floor + (C.max_fv_deviation_base - C.max_fv_deviation_floor) * t;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOMENTUM CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if price has risen too fast recently and buying should be paused.
 *
 * Momentum is measured as the return over the last 30 minutes of price history.
 * If price has risen >8% in 30 minutes, the market is overheating. Buying is
 * blocked for 10 minutes (sells are always allowed).
 *
 * This is the primary defence against Sybil pump attacks:
 * even if 10 accounts are buying across different windows, the aggregate price
 * movement they create triggers the momentum breaker and freezes further buying.
 */
export function checkMomentumBreaker(
  history:     PricePoint[],
  currentPrice: number,
): { triggered: boolean; message?: string } {
  if (history.length < 2) return { triggered: false };

  const now         = Date.now();
  const windowStart = now - C.momentum_window_ms;

  // Find the oldest price within the window
  const windowPrices = history.filter(p => new Date(p.created_at).getTime() >= windowStart);
  if (windowPrices.length === 0) return { triggered: false };

  const oldestInWindow = Number(windowPrices[0].price);
  if (oldestInWindow <= 0) return { triggered: false };

  const rise = (currentPrice - oldestInWindow) / oldestInWindow;
  if (rise > C.momentum_threshold) {
    return {
      triggered: true,
      message:   `Market overheating: price rose ${(rise * 100).toFixed(1)}% in 30 minutes. Buying paused for 10 minutes.`,
    };
  }
  return { triggered: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AMM TRADE EXECUTION — QUADRATIC SLIPPAGE
// ═══════════════════════════════════════════════════════════════════════════════

export interface AMMResult {
  effectivePrice: number;
  slippage:       number;
  priceImpact:    number;
  newPoolX:       number;
  newPoolY:       number;
  qty:            number;
  blocked:        boolean;
  blockReason?:   string;
  feeRate:        number;
}

/**
 * v3 AMM execution with quadratic slippage (exponent=2.0).
 *
 * Why exponent=2.0 vs 1.5?
 *   At exponent=1.5, a $20k trade in an $80k market: (20/100)^1.5 = 8.9% → capped at 5%.
 *   At exponent=2.0, a $20k trade: (20/100)^2.0 = 4%. Not capped, real cost.
 *   But a $40k trade: (40/120)^2.0 = 11.1% → capped at 5%.
 *
 *   Quadratic makes the slippage curve grow much faster for large trades:
 *   4× the trade size = 16× the raw impact (vs 8× at exponent 1.5).
 *   Small trades (< $5k) feel normal. Large trades feel expensive. This is correct.
 *
 * Circuit breaker uses tighter ±15% deviation cap (v2 was ±30%).
 */
export function computeAMMTrade(
  poolX:       number,
  poolY:       number,
  tradeUSD:    number,
  side:        'buy' | 'sell',
  fairValue:   number,
  marketDepth: number,
  hts:         number,
  volatility:  number,
): AMMResult {
  const px    = Number(poolX);
  const py    = Number(poolY);
  const k     = px * py;
  const spot  = (py > 0 && px > 0) ? py / px : fairValue;

  const maxDev    = computeCircuitBreaker(hts);
  const feeRate   = computeDynamicFee(spot, fairValue, volatility, side);
  const maxImpact = C.max_price_impact_per_trade;

  if (k <= 0 || isNaN(k) || isNaN(spot) || spot <= 0) {
    const qty = tradeUSD / fairValue;
    return { effectivePrice: fairValue, slippage: 0, priceImpact: 0, newPoolX: px, newPoolY: py, qty, blocked: false, feeRate };
  }

  // Quadratic slippage
  const rawImpact    = Math.pow(tradeUSD / (marketDepth + tradeUSD), C.slippage_exponent);
  const cappedImpact = Math.min(rawImpact, maxImpact);

  const direction = side === 'buy' ? 1 : -1;
  const newSpot   = spot * (1 + direction * cappedImpact);

  // Circuit breaker check
  const postDev = Math.abs(newSpot - fairValue) / Math.max(fairValue, 1);
  if (postDev > maxDev) {
    const dir = side === 'buy' ? 'above' : 'below';
    return {
      effectivePrice: spot, slippage: 0, priceImpact: 0,
      newPoolX: px, newPoolY: py, qty: 0,
      blocked: true, feeRate,
      blockReason: `Trade blocked: would push price ${(postDev * 100).toFixed(1)}% ${dir} fair value (circuit breaker: ${(maxDev * 100).toFixed(0)}%)`,
    };
  }

  const netUSD = tradeUSD * (1 - feeRate);

  if (side === 'buy') {
    const nY = py + netUSD;
    const nX = k / nY;
    const tokensOut = px - nX;
    if (tokensOut <= 0) return { effectivePrice: spot, slippage: 0, priceImpact: 0, newPoolX: px, newPoolY: py, qty: 0, blocked: false, feeRate };
    const effPrice = tradeUSD / tokensOut;
    return {
      effectivePrice: parseFloat(effPrice.toFixed(4)),
      slippage:       parseFloat((Math.abs(effPrice - spot) / spot).toFixed(4)),
      priceImpact:    cappedImpact,
      newPoolX:       nX, newPoolY: nY, qty: tokensOut,
      blocked: false, feeRate,
    };
  } else {
    const tokensIn = netUSD / spot;
    const nX = px + tokensIn;
    const nY = k / nX;
    const usdOut = py - nY;
    if (usdOut <= 0 || tokensIn <= 0) return { effectivePrice: spot, slippage: 0, priceImpact: 0, newPoolX: px, newPoolY: py, qty: 0, blocked: false, feeRate };
    const effPrice = usdOut / tokensIn;
    return {
      effectivePrice: parseFloat(effPrice.toFixed(4)),
      slippage:       parseFloat((Math.abs(spot - effPrice) / spot).toFixed(4)),
      priceImpact:    cappedImpact,
      newPoolX:       nX, newPoolY: nY, qty: tokensIn,
      blocked: false, feeRate,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWAP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute time-weighted average price over a configurable window.
 * Default window = 30 minutes (was 5 minutes in v2).
 *
 * A 10-minute spike in a 30-minute TWAP contributes only 33% weight.
 * The same spike in a 5-minute TWAP contributed 100% weight (if sustained).
 */
export function computeTWAP(history: PricePoint[], windowMs: number = C.twap_window_ms): number {
  if (history.length === 0) return 0;
  if (history.length === 1) return Number(history[0].price);

  const now         = Date.now();
  const windowStart = now - windowMs;
  const relevant    = history.filter(p => new Date(p.created_at).getTime() >= windowStart);

  if (relevant.length === 0) return Number(history[history.length - 1].price);

  let weightedSum = 0, totalWeight = 0;
  for (let i = 0; i < relevant.length; i++) {
    const tStart   = Math.max(new Date(relevant[i].created_at).getTime(), windowStart);
    const tEnd     = i < relevant.length - 1 ? new Date(relevant[i + 1].created_at).getTime() : now;
    const duration = Math.max(0, tEnd - tStart);
    weightedSum   += Number(relevant[i].price) * duration;
    totalWeight   += duration;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : Number(relevant[relevant.length - 1].price);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY
// ═══════════════════════════════════════════════════════════════════════════════

export function computeVol(history: PricePoint[]): number {
  if (history.length < 4) return 0.05;
  const w    = history.slice(-C.vol_window);
  const rets: number[] = [];
  for (let i = 1; i < w.length; i++) {
    const prev = Number(w[i - 1].price);
    if (prev > 0) rets.push((Number(w[i].price) - prev) / prev);
  }
  if (!rets.length) return 0.05;
  const lambda = 0.94;
  let mean = 0, ws = 0;
  for (let i = 0; i < rets.length; i++) { const wt = Math.pow(lambda, rets.length - 1 - i); mean += wt * rets[i]; ws += wt; }
  mean /= ws;
  let variance = 0; ws = 0;
  for (let i = 0; i < rets.length; i++) { const wt = Math.pow(lambda, rets.length - 1 - i); variance += wt * (rets[i] - mean) ** 2; ws += wt; }
  return Math.max(0.005, Math.sqrt(variance / ws));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC BLEND WEIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PriceWeights {
  wAmm:  number;
  wFv:   number;
  wTwap: number;
}

/**
 * v3 weight model:
 *
 *   Base: 15% AMM, 65% FV, 20% TWAP
 *
 *   Key changes from v2:
 *   - AMM base is 15% (not 40%). Trades signal intent but don't dominate price.
 *   - Volume no longer shifts weight toward AMM. High volume = organic interest
 *     but price discovery is still oracle-led.
 *   - Idle decay is faster (90s half-life). AMM weight fades to near-zero within
 *     5 minutes of no trading activity.
 *   - Settlement convergence is stronger (2-week ramp, 50% FV boost).
 */
export function computeBlendWeights(
  vol:                  number,
  timeSinceLastTradeMs: number,
  hts:                  number,
): PriceWeights {
  let wAmm  = C.w_amm_base;
  let wFv   = C.w_fv_base;
  let wTwap = C.w_twap_base;

  // 1. High volatility: shift from AMM → FV
  const volRatio = vol / C.target_vol;
  if (volRatio > 1) {
    const shift = Math.min(0.10, (volRatio - 1) * 0.04);
    wAmm -= shift;
    wFv  += shift;
  }

  // 2. Idle decay: AMM fades toward zero when no trades
  const idleFactor = Math.exp(-timeSinceLastTradeMs / C.idle_halflife_ms);
  const idleShift  = (1 - idleFactor) * 0.15;  // max 15% shift out of AMM
  wAmm  -= idleShift;
  wFv   += idleShift * 0.70;
  wTwap += idleShift * 0.30;

  // 3. Volume no longer increases AMM weight (v2 attack vector removed).
  //    High organic volume is good — it deepens the pool — but it doesn't
  //    mean the AMM spot should be more trusted.

  // 4. Settlement convergence: FV becomes near-total authority
  if (hts < C.settlement_anchor_hours) {
    const t = 1 - hts / C.settlement_anchor_hours;
    const shift = t * C.settlement_fv_boost;
    wFv   += shift;
    wAmm  -= shift * 0.80;
    wTwap -= shift * 0.20;
  }

  wAmm  = Math.max(0, wAmm);
  wFv   = Math.max(0, wFv);
  wTwap = Math.max(0, wTwap);
  const total = wAmm + wFv + wTwap;

  return {
    wAmm:  parseFloat((wAmm  / total).toFixed(4)),
    wFv:   parseFloat((wFv   / total).toFixed(4)),
    wTwap: parseFloat((wTwap / total).toFixed(4)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT PRICE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the final settlement price.
 *
 * Formula: 0.80 × FinalFairValue + 0.20 × TWAP_24h
 *
 * Key design choice: settlement is 80% oracle-driven.
 * This means a manipulator controlling 100% of market activity cannot
 * move settlement price by more than (maxFvDev × 0.20 × TWAP_weight)
 * beyond fair value.
 *
 * Example: player FV = $300. Attacker holds price at FV+15% (+$45) for
 * all 24h before settlement. TWAP_24h ≈ $345.
 * Settlement = 0.80 × $300 + 0.20 × $345 = $240 + $69 = $309.
 * Attacker moved settlement by only $9 (3%) despite controlling price all day.
 *
 * Note: history must be the FULL 24h price history (not just last 5 min).
 */
export function computeSettlementPrice(fairValue: number, history: PricePoint[]): number {
  const twap24h = computeTWAP(history, C.settlement_twap_window_ms);
  const settlement = 0.80 * fairValue + 0.20 * (twap24h > 0 ? twap24h : fairValue);
  return parseFloat(Math.max(C.min_price, settlement).toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TICK
// ═══════════════════════════════════════════════════════════════════════════════

export interface TickResult {
  blendedPrice:   number;
  ammSpot:        number;
  fairValue:      number;
  twap:           number;
  evScore:        number;
  volatility:     number;
  weights:        PriceWeights;
  newPoolX:       number;
  newPoolY:       number;
  marketDepth:    number;
  momentumBreaker: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NO-GAME TICK — Ornstein-Uhlenbeck mean-reversion process
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used when no NBA game is in progress. Keeps prices visibly alive while
// preventing exploitation:
//
//   P(t+1) = P(t) + α_eff·(FV − P(t)) + σ_eff·Z_clamped
//
// Why this is non-exploitable:
//   Drift at α=0.004, $10 deviation = $0.04/tick.
//   Noise is $0.20/tick (5× the drift signal).
//   Cumulative noise over N ticks = ±$0.20·√N >> cumulative drift gain.
//   Any trade trying to ride the drift loses to fee + noise uncertainty.
//
// α varies with:
//   - Game proximity (ramps up as tip-off approaches — faster convergence)
//   - Settlement proximity (fast lock-in during final 48h)
//   - Player liquidity (high-volume players revert slower — already near FV)
//
// σ varies with:
//   - Game proximity (pre-game anticipation raises volatility)
//   - Player liquidity (high-liquidity players are quieter)
//   - Hard Z-clamp at ±2 eliminates fat tails entirely
//
export function noGameTick(
  player:               Player,
  history:              PricePoint[],
  hoursUntilNextGame:   number,    // Infinity if no games today; 0 just before tip-off
  recentVolume24hUSD:   number,
): TickResult {
  const fv      = computeFairValue(player);
  const evScore = computeEVScore(player);
  const twap    = computeTWAP(history);
  const vol     = computeVol(history);
  const hts     = hoursToSettlement();
  const cur     = Number(player.current_price);
  const px      = Number(player.pool_x);
  const py      = Number(player.pool_y);

  // ── Effective reversion speed (α) ────────────────────────────────────────
  // Scales up approaching tip-off (price should be near FV when trading starts)
  // and approaching settlement (final convergence).
  let alpha = NG.alpha_base;

  // Proximity ramp: within 8h of game, alpha increases linearly
  const hClamped = Math.max(0, Math.min(NG.proximity_window_hours, hoursUntilNextGame));
  const proximityFraction = 1 - hClamped / NG.proximity_window_hours; // 0 far, 1 at tip-off
  alpha += NG.alpha_base * proximityFraction * 0.5; // up to 50% boost near tip-off

  // Settlement ramp: within 48h, alpha triples to lock price onto FV
  if (hts < NG.settlement_ramp_hours) {
    const settlementFraction = 1 - hts / NG.settlement_ramp_hours;
    alpha *= (1 + (NG.settlement_alpha_mult - 1) * settlementFraction);
  }

  // Liquidity dampening: high-volume players already efficient, less reversion needed
  const liquidityScale = 1 / Math.sqrt(1 + Math.max(0, recentVolume24hUSD) / NG.liquidity_base);
  alpha = Math.min(NG.alpha_max, alpha * liquidityScale);

  // ── Effective volatility (σ) ─────────────────────────────────────────────
  // Pre-game anticipation: σ scales up as tip-off approaches
  const proximityBoost = 1 + (NG.proximity_boost_max - 1) * proximityFraction;
  const sigma = NG.sigma_base * proximityBoost * liquidityScale * cur;

  // ── Bounded Gaussian noise ────────────────────────────────────────────────
  // Box-Muller transform, Z clamped at ±noise_clamp → no fat tails
  const u1 = Math.random(), u2 = Math.random();
  const z        = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  const zClamped = Math.max(-NG.noise_clamp, Math.min(NG.noise_clamp, z));
  const noise    = sigma * zClamped;

  // ── O-U drift toward fair value ───────────────────────────────────────────
  const drift = alpha * (fv - cur);

  // ── Combine and hard-cap ──────────────────────────────────────────────────
  const rawMove    = drift + noise;
  const maxMove    = cur * NG.max_tick_pct;
  const cappedMove = Math.max(-maxMove, Math.min(maxMove, rawMove));
  const newPrice   = parseFloat(Math.max(C.min_price, cur + cappedMove).toFixed(2));

  // ── Recalibrate AMM pools to new price ───────────────────────────────────
  const k        = px * py;
  const newPoolX = k > 0 ? parseFloat(Math.sqrt(k / newPrice).toFixed(6)) : px;
  const newPoolY = k > 0 ? parseFloat((k / newPoolX).toFixed(4)) : py;

  // In no-game mode the oracle is the only signal — weights reflect this
  const weights: PriceWeights = { wAmm: 0.05, wFv: 0.90, wTwap: 0.05 };

  return {
    blendedPrice:    newPrice,
    ammSpot:         parseFloat(newPrice.toFixed(2)),
    fairValue:       fv,
    twap:            parseFloat((twap > 0 ? twap : cur).toFixed(2)),
    evScore:         parseFloat(evScore.toFixed(2)),
    volatility:      parseFloat(vol.toFixed(4)),
    weights,
    newPoolX,
    newPoolY,
    marketDepth:     parseFloat(computeMarketDepth(player, fv, recentVolume24hUSD).toFixed(2)),
    momentumBreaker: false, // momentum breaker inactive during no-game periods
  };
}

export function tick(
  player:               Player,
  history:              PricePoint[],
  recentVolume24hUSD:   number,
  timeSinceLastTradeMs: number,
): TickResult {
  const fv       = computeFairValue(player);
  const evScore  = computeEVScore(player);
  const twap     = computeTWAP(history);     // 30-min TWAP
  const vol      = computeVol(history);
  const hts      = hoursToSettlement();
  const progress = seasonProgress();

  const px      = Number(player.pool_x);
  const py      = Number(player.pool_y);
  const cur     = Number(player.current_price);
  const ammSpot = (py > 0 && px > 0) ? py / px : cur;

  const depth   = computeMarketDepth(player, fv, recentVolume24hUSD);
  const weights = computeBlendWeights(vol, timeSinceLastTradeMs, hts);

  // ── Momentum breaker flag (stored — trading.ts enforces it on buys) ───────
  const { triggered: momentumBreaker } = checkMomentumBreaker(history, cur);

  // ── Mean-reversion drift (AMM spot drifts toward FV each tick) ────────────
  const baseAlpha  = C.drift_base + C.drift_season_boost * progress;
  const deviation  = (ammSpot - fv) / Math.max(fv, 1);
  const absDev     = Math.abs(deviation);
  const rubberBand = absDev > C.deviation_boost_threshold
    ? C.deviation_boost_multiplier * (absDev - C.deviation_boost_threshold)
    : 0;
  const alpha = baseAlpha + rubberBand;
  const drift = alpha * (fv - ammSpot);

  // ── Dampened noise ────────────────────────────────────────────────────────
  // Use a minimum vol floor so noise never collapses to near-zero when the
  // market is quiet. This guarantees $1–$5 visible moves per tick on typical shares.
  const effectiveVol = Math.max(vol, C.noise_min_vol);
  const noiseDamp = Math.exp(-absDev / C.noise_damp_decay);
  const u1 = Math.random(), u2 = Math.random();
  const z   = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  const noise = z * effectiveVol * ammSpot * C.noise_scale * noiseDamp;

  let newAmmSpot = ammSpot + drift + noise;
  const maxMove  = ammSpot * C.max_tick;
  newAmmSpot     = Math.max(ammSpot - maxMove, Math.min(ammSpot + maxMove, newAmmSpot));
  newAmmSpot     = Math.max(C.min_price, newAmmSpot);

  // ── Blended price (oracle-dominant) ──────────────────────────────────────
  const twapOrCur = twap > 0 ? twap : cur;
  let blended = weights.wAmm * newAmmSpot + weights.wFv * fv + weights.wTwap * twapOrCur;
  blended     = Math.max(C.min_price, parseFloat(blended.toFixed(2)));

  // ── Recalibrate pools to blended price ───────────────────────────────────
  const k        = px * py;
  const newPoolX = k > 0 ? parseFloat(Math.sqrt(k / blended).toFixed(6)) : px;
  const newPoolY = k > 0 ? parseFloat((k / newPoolX).toFixed(4)) : py;

  return {
    blendedPrice:    blended,
    ammSpot:         parseFloat(newAmmSpot.toFixed(2)),
    fairValue:       fv,
    twap:            parseFloat(twapOrCur.toFixed(2)),
    evScore:         parseFloat(evScore.toFixed(2)),
    volatility:      parseFloat(vol.toFixed(4)),
    weights,
    newPoolX,
    newPoolY,
    marketDepth:     parseFloat(depth.toFixed(2)),
    momentumBreaker,
  };
}
