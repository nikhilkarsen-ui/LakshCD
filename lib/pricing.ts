// ============================================================
// LAKSH v3 — Pricing Engine
// Prediction-market model: price = market's estimate of
// the player's final settlement value at season end.
//
// Key design:
//   - price drifts toward expected_final_value each tick
//   - convergence strengthens as season approaches end
//   - trade activity moves price immediately via AMM
//   - noise is small and bounded (not the main driver)
// ============================================================

import { Player, PricePoint } from '@/types';
import { PRICING as C, SEASON } from '@/config/constants';

// ─── Expected Final Value ─────────────────────────────────
// Projects the player's likely season-end settlement price
// based on current season stats. Returns dollars.
//
// Weights: PPG(35%) + APG(20%) + RPG(20%) + EFF(25%)
// Maps raw 0–1 score → dollar price via efv_scale.
// ─────────────────────────────────────────────────────────
export function computeExpectedFinalValue(p: Player): number {
  const totalGames = SEASON.total_games;

  const projPts = Number(p.ppg) * totalGames;
  const projAst = Number(p.apg) * totalGames;
  const projReb = Number(p.rpg) * totalGames;
  const projEff = Number(p.efficiency) * totalGames;

  const raw =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;

  // EV score 0–1000, then scale to dollars
  const evScore = Math.max(0, Math.min(1000, raw * 1000));
  return Math.max(5, parseFloat((evScore * C.efv_scale).toFixed(2)));
}

// Legacy alias — tick route stores this as expected_value (raw 0–1000 score)
export function computeEV(p: Player): number {
  const totalGames = SEASON.total_games;
  const projPts = Number(p.ppg) * totalGames;
  const projAst = Number(p.apg) * totalGames;
  const projReb = Number(p.rpg) * totalGames;
  const projEff = Number(p.efficiency) * totalGames;
  const raw =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;
  return Math.max(0, Math.min(1000, raw * 1000));
}

// ─── Volatility ───────────────────────────────────────────
// EWMA standard deviation of recent returns.
// ─────────────────────────────────────────────────────────
export function computeVol(history: PricePoint[]): number {
  if (history.length < 4) return 0.05;
  const w = history.slice(-C.trend_window);
  const rets: number[] = [];
  for (let i = 1; i < w.length; i++) {
    const prev = Number(w[i - 1].price);
    if (prev > 0) rets.push((Number(w[i].price) - prev) / prev);
  }
  if (!rets.length) return 0.05;
  const lambda = 0.94;
  let m = 0, ws = 0;
  for (let i = 0; i < rets.length; i++) { const wt = Math.pow(lambda, rets.length - 1 - i); m += wt * rets[i]; ws += wt; }
  m /= ws;
  let v = 0; ws = 0;
  for (let i = 0; i < rets.length; i++) { const wt = Math.pow(lambda, rets.length - 1 - i); v += wt * (rets[i] - m) ** 2; ws += wt; }
  return Math.max(0.005, Math.sqrt(v / ws));
}

// ─── Momentum ─────────────────────────────────────────────
export function computeMomentum(history: PricePoint[]): number {
  if (history.length < 3) return 0;
  let ema = Number(history[0].price);
  for (let i = 1; i < history.length; i++) ema = C.ema_alpha * Number(history[i].price) + (1 - C.ema_alpha) * ema;
  const cur = Number(history[history.length - 1].price);
  return ema > 0 ? (cur - ema) / ema : 0;
}

// ─── Season Progress (0 = start, 1 = end) ────────────────
// Used to strengthen price convergence toward EFV as season ends.
export function seasonProgress(): number {
  const start = new Date(SEASON.start_date).getTime();
  const end = new Date(SEASON.settlement_date).getTime();
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}

// ─── AMM Impact ──────────────────────────────────────────
// Constant-product AMM. Buys push price up, sells push down.
// spot_price = pool_y / pool_x
// ─────────────────────────────────────────────────────────
export function computeAMMImpact(poolX: number, poolY: number, usd: number, side: 'buy' | 'sell') {
  const px = Number(poolX), py = Number(poolY);
  const k = px * py;
  const spot = py > 0 && px > 0 ? py / px : 300;

  if (k <= 0 || isNaN(k)) {
    return { effectivePrice: spot, slippage: 0, newX: px, newY: py, qty: usd / spot };
  }

  if (side === 'buy') {
    const nY = py + usd;
    const nX = k / nY;
    const tokensOut = px - nX;
    if (tokensOut <= 0) return { effectivePrice: spot, slippage: 0, newX: px, newY: py, qty: 0 };
    const eff = usd / tokensOut;
    const slip = Math.abs(eff - spot) / spot;
    return { effectivePrice: eff, slippage: Math.min(slip, 0.1), newX: nX, newY: nY, qty: tokensOut };
  } else {
    // Sell: derive token input from dollar notional at spot
    const tokensIn = usd / spot;
    const nX = px + tokensIn;
    const nY = k / nX;
    const usdOut = py - nY;
    if (usdOut <= 0 || tokensIn <= 0) return { effectivePrice: spot, slippage: 0, newX: px, newY: py, qty: 0 };
    const eff = usdOut / tokensIn;
    const slip = Math.abs(spot - eff) / spot;
    return { effectivePrice: eff, slippage: Math.min(slip, 0.1), newX: nX, newY: nY, qty: tokensIn };
  }
}

// ─── Price Tick ───────────────────────────────────────────
// Called every 5 seconds. Price drifts toward expected_final_value.
// Convergence is stronger as season approaches settlement.
// Noise is small — ticks should feel like a prediction market
// updating its estimate, not random walk.
// ─────────────────────────────────────────────────────────
export function tick(player: Player, history: PricePoint[]) {
  const efv = computeExpectedFinalValue(player);
  const evScore = computeEV(player);
  const vol = computeVol(history);
  const mom = computeMomentum(history);
  const cur = Number(player.current_price);
  if (cur <= 0 || isNaN(cur)) return { price: efv, ev: evScore, expectedFinalValue: efv, volatility: 0.05 };

  // Convergence factor: strengthens as season progresses
  // At season start (progress=0): alpha ≈ drift_base
  // At season end   (progress=1): alpha ≈ drift_base + drift_season_boost
  const progress = seasonProgress();
  const alpha = C.drift_base + C.drift_season_boost * progress;

  // Live game boost: temporarily shifts the EFV target up or down based on
  // today's box score vs the player's season average.
  // Boost is -1..+1; live_boost_scale caps the max EFV shift (default 20%).
  // Ignored once live_boost_expires_at has passed.
  const boostActive =
    player.live_boost_expires_at != null &&
    Date.now() < new Date(player.live_boost_expires_at).getTime();
  const boost = boostActive ? Number(player.live_game_boost ?? 0) : 0;
  const boostedEfv = efv * (1 + boost * C.live_boost_scale);

  // Mean-reversion drift toward (possibly boosted) expected final value
  const drift = alpha * (boostedEfv - cur);

  // Small momentum contribution (trend-following)
  const momDelta = mom * cur * C.momentum_w;

  // Small bounded Gaussian noise (much less than in futures model)
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  const noise = z * vol * cur * C.noise;

  let np = cur + drift + momDelta + noise;

  // Cap single-tick move at max_tick (3% of current price)
  const mx = cur * C.max_tick;
  np = Math.max(cur - mx, Math.min(cur + mx, np));
  np = Math.max(5, np);

  return {
    price: parseFloat(np.toFixed(2)),
    ev: parseFloat(evScore.toFixed(2)),
    expectedFinalValue: parseFloat(efv.toFixed(2)),
    volatility: parseFloat(vol.toFixed(4)),
  };
}
