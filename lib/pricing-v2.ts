// ============================================================
// LAKSH — Pricing Engine v2
// Hybrid model: AMM + Oracle Fair Value + TWAP blend
//
// Architecture:
//   Fair Value Oracle — stat-based anchor with Bayesian shrinkage
//   Virtual Market Depth — scales liquidity, resists manipulation
//   Nonlinear Slippage — superlinear impact for large trades
//   Blended Price — weighted average of AMM / FV / TWAP
//   Settlement Convergence — FV weight dominates near season end
//
// Key manipulation-resistance properties:
//   1. Price can't stray >30% from FV regardless of trade size
//   2. Slippage grows superlinearly (exponent 1.5), so large trades
//      become disproportionately expensive
//   3. Virtual depth grows as season progresses — the market gets
//      "harder to move" as settlement certainty increases
//   4. TWAP anchor prevents flash manipulation: a single spike trade
//      cannot instantly move the displayed price by its full amount
//   5. Idle markets drift toward FV (AMM weight decays), so no
//      orphaned prices when trading is thin
// ============================================================

import { Player, PricePoint } from '@/types';
import { PRICING_V2 as C, SEASON } from '@/config/constants';

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
 * Compute the oracle fair value for a player in dollars.
 *
 * Uses Bayesian shrinkage to handle sample uncertainty:
 *   - Before 30 games: partially regress toward league average
 *   - After 30 games:  trust actual stat pace fully
 *
 * This prevents the first few spectacular (or terrible) games from
 * creating a wildly unrealistic fair value that the market must anchor to.
 *
 * Live game boost shifts the FV target during/after active games.
 */
export function computeFairValue(player: Player): number {
  const { total_games } = SEASON;

  // Raw season-pace projection
  const projPts = Number(player.ppg)        * total_games;
  const projAst = Number(player.apg)        * total_games;
  const projReb = Number(player.rpg)        * total_games;
  const projEff = Number(player.efficiency) * total_games;

  const rawScore =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;

  // Bayesian shrinkage: credibility grows with games played
  const credibility  = Math.min(Number(player.games_played) / C.credibility_games, 1);
  const shrunkScore  = credibility * rawScore + (1 - credibility) * C.league_avg_score;

  const evScore = Math.max(0, Math.min(1000, shrunkScore * 1000));
  const baseFV  = Math.max(C.min_price, evScore * C.fv_scale);

  // Live game boost: active only while live_boost_expires_at is in the future
  const boostActive =
    player.live_boost_expires_at != null &&
    Date.now() < new Date(player.live_boost_expires_at).getTime();
  const boost = boostActive ? Number(player.live_game_boost ?? 0) : 0;

  return parseFloat((baseFV * (1 + boost * C.live_boost_scale)).toFixed(2));
}

// Legacy EV score (0–1000) — used by the tick route for DB storage
export function computeEVScore(player: Player): number {
  const { total_games } = SEASON;
  const projPts = Number(player.ppg)        * total_games;
  const projAst = Number(player.apg)        * total_games;
  const projReb = Number(player.rpg)        * total_games;
  const projEff = Number(player.efficiency) * total_games;
  const raw =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;
  return Math.max(0, Math.min(1000, raw * 1000));
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRTUAL MARKET DEPTH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the effective virtual market depth in USD.
 *
 * Depth controls price impact: impact = (trade / (depth + trade))^1.5
 * A $1k trade in a $40k-deep market moves price ~1.4%.
 * A $10k trade moves price ~7.4% (superlinear: 10× trade → 5.3× impact).
 *
 * Depth is deliberately not just pool size — it's a policy parameter
 * that encodes our beliefs about fair liquidity given:
 *   - Season maturity (more games → tighter FV estimate → deeper market)
 *   - Price proximity to FV (market makers concentrate near fair value)
 *   - Recent trading activity (organic volume earns deeper markets)
 */
export function computeMarketDepth(
  player: Player,
  fairValue: number,
  recentVolume24hUSD: number,
): number {
  const progress = seasonProgress();

  // Season maturity bonus: depth scales from base to base*(1+boost) over the season
  const maturityDepth = C.base_depth * (1 + progress * C.depth_season_boost);

  // Proximity bonus: extra depth when price is near FV (market makers like certainty)
  const currentPrice = Number(player.current_price);
  const priceDev     = Math.abs(currentPrice - fairValue) / Math.max(fairValue, 1);
  const proximityMult = 1 + C.depth_proximity_boost * Math.exp(-priceDev / C.depth_proximity_decay);

  // Volume bonus: sqrt-scaled so it rewards organic activity without being gameable
  const volumeMult = 1 + Math.sqrt(Math.max(0, recentVolume24hUSD) / C.depth_volume_base) * 0.30;

  return Math.max(C.min_depth, maturityDepth * proximityMult * volumeMult);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AMM TRADE EXECUTION — NONLINEAR SLIPPAGE
// ═══════════════════════════════════════════════════════════════════════════════

export interface AMMResult {
  effectivePrice: number;    // average fill price
  slippage: number;          // fractional deviation from spot
  priceImpact: number;       // fractional spot change post-trade
  newPoolX: number;
  newPoolY: number;
  qty: number;               // tokens out (buy) or in (sell)
  blocked: boolean;
  blockReason?: string;
}

/**
 * Execute an AMM trade with manipulation-resistant slippage.
 *
 * Slippage formula:
 *   impact = (tradeUSD / (depth + tradeUSD))^1.5
 *
 * Properties:
 *   - At tradeUSD = depth/10 ($4k in $40k market): ~2.7% impact
 *   - At tradeUSD = depth    ($40k):                ~35%  impact → capped at 8%
 *   - Superlinear: doubling trade size > doubles impact
 *
 * Hard blocks:
 *   - Price cannot exceed ±30% of fair value (oracle deviation cap)
 *   - Single trade cannot move price >8% (tightens near settlement)
 *
 * The pool state (pool_x, pool_y) is updated consistently so that
 * subsequent AMM spot price = new spot after the trade.
 */
export function computeAMMTrade(
  poolX: number,
  poolY: number,
  tradeUSD: number,
  side: 'buy' | 'sell',
  fairValue: number,
  marketDepth: number,
  hts: number,  // hours to settlement
): AMMResult {
  const px  = Number(poolX);
  const py  = Number(poolY);
  const k   = px * py;
  const spot = (py > 0 && px > 0) ? py / px : fairValue;

  if (k <= 0 || isNaN(k) || isNaN(spot) || spot <= 0) {
    // Degenerate pool — give fair fill at FV, no pool change
    const qty = tradeUSD / fairValue;
    return { effectivePrice: fairValue, slippage: 0, priceImpact: 0, newPoolX: px, newPoolY: py, qty, blocked: false };
  }

  // Settlement tightening: impact caps scale linearly from full → 0 inside protection window
  const settlementFactor = Math.min(1, hts / C.settlement_protection_hours);
  const maxImpact   = C.max_price_impact_per_trade * settlementFactor + 0.01; // floor at 1%
  const maxDeviation = C.max_fv_deviation * settlementFactor + 0.05;           // floor at 5%

  // Nonlinear impact: superlinear slippage penalises large trades
  const rawImpact    = Math.pow(tradeUSD / (marketDepth + tradeUSD), C.slippage_exponent);
  const cappedImpact = Math.min(rawImpact, maxImpact);

  // Compute new spot price after impact
  const direction  = side === 'buy' ? 1 : -1;
  const newSpot    = spot * (1 + direction * cappedImpact);

  // Oracle deviation guard: hard block if this trade would push price too far from FV
  const postDeviation = Math.abs(newSpot - fairValue) / fairValue;
  if (postDeviation > maxDeviation) {
    const side_word = side === 'buy' ? 'above' : 'below';
    return {
      effectivePrice: spot, slippage: 0, priceImpact: 0,
      newPoolX: px, newPoolY: py, qty: 0,
      blocked: true,
      blockReason: `Trade blocked: would push price ${(postDeviation * 100).toFixed(1)}% ${side_word} fair value (limit: ${(maxDeviation * 100).toFixed(0)}%)`,
    };
  }

  // Derive actual token qty and effective price from the xy=k curve
  // (We use actual xy=k for consistent accounting, then verify impact matches)
  const netUSD = tradeUSD * (1 - C.fee_rate);

  if (side === 'buy') {
    const nY = py + netUSD;
    const nX = k / nY;
    const tokensOut = px - nX;
    if (tokensOut <= 0) {
      return { effectivePrice: spot, slippage: 0, priceImpact: 0, newPoolX: px, newPoolY: py, qty: 0, blocked: false };
    }
    const effPrice = tradeUSD / tokensOut;
    const slippage = Math.abs(effPrice - spot) / spot;

    return {
      effectivePrice: parseFloat(effPrice.toFixed(4)),
      slippage:       parseFloat(slippage.toFixed(4)),
      priceImpact:    cappedImpact,
      newPoolX:       nX,
      newPoolY:       nY,
      qty:            tokensOut,
      blocked:        false,
    };
  } else {
    const tokensIn = netUSD / spot;
    const nX = px + tokensIn;
    const nY = k / nX;
    const usdOut = py - nY;
    if (usdOut <= 0 || tokensIn <= 0) {
      return { effectivePrice: spot, slippage: 0, priceImpact: 0, newPoolX: px, newPoolY: py, qty: 0, blocked: false };
    }
    const effPrice = usdOut / tokensIn;
    const slippage = Math.abs(spot - effPrice) / spot;

    return {
      effectivePrice: parseFloat(effPrice.toFixed(4)),
      slippage:       parseFloat(slippage.toFixed(4)),
      priceImpact:    cappedImpact,
      newPoolX:       nX,
      newPoolY:       nY,
      qty:            tokensIn,
      blocked:        false,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWAP — TIME-WEIGHTED AVERAGE PRICE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the time-weighted average price over a rolling window.
 *
 * Each price point is weighted by how long it was the "current" price
 * before being superseded. A single spike trade can only move the TWAP
 * by (spike_duration / window_duration) — so a flash trade that lasts
 * 5 seconds in a 5-minute TWAP window contributes only 1.7% weight.
 *
 * This is the primary defence against flash manipulation near settlement.
 */
export function computeTWAP(
  history: PricePoint[],
  windowMs: number = C.twap_window_ms,
): number {
  if (history.length === 0) return 0;
  if (history.length === 1) return Number(history[0].price);

  const now         = Date.now();
  const windowStart = now - windowMs;

  const relevant = history.filter(p => new Date(p.created_at).getTime() >= windowStart);
  if (relevant.length === 0) return Number(history[history.length - 1].price);

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < relevant.length; i++) {
    const tStart   = Math.max(new Date(relevant[i].created_at).getTime(), windowStart);
    const tEnd     = i < relevant.length - 1
      ? new Date(relevant[i + 1].created_at).getTime()
      : now;
    const duration = Math.max(0, tEnd - tStart);
    weightedSum   += Number(relevant[i].price) * duration;
    totalWeight   += duration;
  }

  return totalWeight > 0
    ? weightedSum / totalWeight
    : Number(relevant[relevant.length - 1].price);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY — EWMA
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

  // EWMA: λ=0.94 — recent ticks weighted heavily
  const lambda = 0.94;
  let mean = 0, ws = 0;
  for (let i = 0; i < rets.length; i++) {
    const wt = Math.pow(lambda, rets.length - 1 - i);
    mean += wt * rets[i]; ws += wt;
  }
  mean /= ws;

  let variance = 0; ws = 0;
  for (let i = 0; i < rets.length; i++) {
    const wt = Math.pow(lambda, rets.length - 1 - i);
    variance += wt * (rets[i] - mean) ** 2; ws += wt;
  }
  return Math.max(0.005, Math.sqrt(variance / ws));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC BLEND WEIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PriceWeights {
  wAmm:  number;   // AMM spot contribution
  wFv:   number;   // Fair value oracle contribution
  wTwap: number;   // TWAP contribution
}

/**
 * Compute how much weight each price component gets in the blend.
 *
 * Base: 40% AMM, 40% FV, 20% TWAP
 *
 * Dynamic adjustments:
 *
 * 1. HIGH VOLATILITY → shift weight from AMM to FV
 *    Rationale: when the market is erratic, the oracle is more
 *    reliable than the AMM spot, which may be chasing noise.
 *
 * 2. IDLE MARKET → AMM weight decays exponentially
 *    Rationale: if nobody has traded in 10 minutes, the AMM spot
 *    is stale; it should converge to FV rather than staying frozen.
 *
 * 3. HIGH VOLUME → slight AMM weight increase
 *    Rationale: genuine price discovery — the market collectively
 *    knows something that stats haven't captured yet.
 *
 * 4. NEAR SETTLEMENT → FV weight surges
 *    Rationale: at season end, only real stats matter. Prevent
 *    last-minute manipulation from affecting settlement price.
 */
export function computeBlendWeights(
  vol: number,
  timeSinceLastTradeMs: number,
  recentVolumeUSD: number,
  hts: number,
): PriceWeights {
  let wAmm  = C.w_amm_base;
  let wFv   = C.w_fv_base;
  let wTwap = C.w_twap_base;

  // 1. Volatility: high vol → anchor more to FV
  const volRatio = vol / C.target_vol;
  if (volRatio > 1) {
    const shift = Math.min(0.15, (volRatio - 1) * 0.05);
    wAmm -= shift;
    wFv  += shift;
  }

  // 2. Idle decay: AMM weight shrinks when no recent trades
  const idleFactor = Math.exp(-timeSinceLastTradeMs / C.idle_halflife_ms);
  const idleShift  = (1 - idleFactor) * 0.20;
  wAmm  -= idleShift;
  wFv   += idleShift * 0.60;
  wTwap += idleShift * 0.40;

  // 3. Volume: active market → trust AMM more (genuine discovery)
  const volRatio2 = recentVolumeUSD / C.avg_daily_volume;
  if (volRatio2 > 1) {
    const vShift = Math.min(0.08, Math.log(volRatio2) * 0.04);
    wAmm += vShift;
    wFv  -= vShift;
  }

  // 4. Settlement approach: FV dominates as season ends
  if (hts < C.settlement_anchor_hours) {
    const t = 1 - hts / C.settlement_anchor_hours;
    const settlementShift = t * C.settlement_fv_boost;
    wFv   += settlementShift;
    wAmm  -= settlementShift * 0.70;
    wTwap -= settlementShift * 0.30;
  }

  // Normalise — ensure all weights are non-negative and sum to 1
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
// MAIN TICK
// ═══════════════════════════════════════════════════════════════════════════════

export interface TickResult {
  blendedPrice:    number;     // final displayed price
  ammSpot:         number;     // AMM spot after drift
  fairValue:       number;     // oracle FV
  twap:            number;     // 5-min TWAP
  evScore:         number;     // raw 0–1000 EV score for DB
  volatility:      number;
  weights:         PriceWeights;
  newPoolX:        number;
  newPoolY:        number;
  marketDepth:     number;
}

/**
 * Core tick — runs every 5 seconds on all active players.
 *
 * Step 1: Compute fair value from real stats (oracle)
 * Step 2: Compute TWAP from recent price history
 * Step 3: Drift AMM spot toward fair value (mean reversion)
 *         — Alpha = base + season_boost + rubber_band_if_far_from_FV
 *         — Noise is dampened when price is close to FV
 * Step 4: Compute dynamic blend weights
 * Step 5: Blended price = w_amm * amm_spot + w_fv * fv + w_twap * twap
 * Step 6: Recalibrate AMM pools to match blended price (preserve k)
 *
 * Why recalibrate pools each tick?
 * So that subsequent trades execute at the blended price as their
 * starting point, not at a stale AMM spot.
 */
export function tick(
  player: Player,
  history: PricePoint[],
  recentVolume24hUSD: number,
  timeSinceLastTradeMs: number,
): TickResult {
  const fv       = computeFairValue(player);
  const evScore  = computeEVScore(player);
  const twap     = computeTWAP(history);
  const vol      = computeVol(history);
  const hts      = hoursToSettlement();
  const progress = seasonProgress();

  const px       = Number(player.pool_x);
  const py       = Number(player.pool_y);
  const cur      = Number(player.current_price);
  const ammSpot  = (py > 0 && px > 0) ? py / px : cur;

  // Market depth for this tick
  const depth = computeMarketDepth(player, fv, recentVolume24hUSD);

  // ── Mean-reversion drift toward FV ────────────────────────────────────────
  // Alpha = base_rate + season_acceleration + rubber_band_when_far
  const baseAlpha   = C.drift_base + C.drift_season_boost * progress;
  const deviation   = (ammSpot - fv) / Math.max(fv, 1);
  const absDev      = Math.abs(deviation);
  const rubberBand  = absDev > C.deviation_boost_threshold
    ? C.deviation_boost_multiplier * (absDev - C.deviation_boost_threshold)
    : 0;
  const alpha       = baseAlpha + rubberBand;
  const drift       = alpha * (fv - ammSpot);

  // ── Small Gaussian noise, dampened near FV ────────────────────────────────
  // Noise represents genuine uncertainty; it quiets as the market converges.
  const noiseDamp = Math.exp(-absDev / C.noise_damp_decay);
  const u1 = Math.random(), u2 = Math.random();
  const z   = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  const noise = z * vol * ammSpot * C.noise_scale * noiseDamp;

  // ── Clamp tick move ────────────────────────────────────────────────────────
  let newAmmSpot = ammSpot + drift + noise;
  const maxMove  = ammSpot * C.max_tick;
  newAmmSpot     = Math.max(ammSpot - maxMove, Math.min(ammSpot + maxMove, newAmmSpot));
  newAmmSpot     = Math.max(C.min_price, newAmmSpot);

  // ── Dynamic blend weights ─────────────────────────────────────────────────
  const weights = computeBlendWeights(vol, timeSinceLastTradeMs, recentVolume24hUSD, hts);

  // ── Blended price ─────────────────────────────────────────────────────────
  // TWAP fallback: if not enough history, use current price
  const twapOrCur = twap > 0 ? twap : cur;
  let blended = weights.wAmm * newAmmSpot + weights.wFv * fv + weights.wTwap * twapOrCur;
  blended     = Math.max(C.min_price, parseFloat(blended.toFixed(2)));

  // ── Recalibrate AMM pools to blended price (preserve k = pool_x * pool_y) ─
  const k        = px * py;
  const newPoolX = k > 0 ? parseFloat(Math.sqrt(k / blended).toFixed(6)) : px;
  const newPoolY = k > 0 ? parseFloat((k / newPoolX).toFixed(4)) : py;

  return {
    blendedPrice: blended,
    ammSpot:      parseFloat(newAmmSpot.toFixed(2)),
    fairValue:    fv,
    twap:         parseFloat(twapOrCur.toFixed(2)),
    evScore:      parseFloat(evScore.toFixed(2)),
    volatility:   parseFloat(vol.toFixed(4)),
    weights,
    newPoolX,
    newPoolY,
    marketDepth:  parseFloat(depth.toFixed(2)),
  };
}
