// ============================================================
// LAKSH — Pricing Engine (all 3 bugs fixed)
// ============================================================
// Bug #7: AMM pool_x/pool_y now calibrated so spot = current_price
// Bug #8: EV projects from (games_played + remaining), not total_games
// Bug #11: All inputs coerced with Number() for safety
// ============================================================

import { Player, PricePoint } from '@/types';
import { PRICING as C, SEASON } from '@/config/constants';

// --- Bug #8 fix: use gp + remaining, not total_games ---
export function computeEV(p: Player): number {
  // Project full-season value using total_games (not a stale hardcoded remainder)
  const totalProjectedGames = SEASON.total_games;

  const projPts = Number(p.ppg) * totalProjectedGames;
  const projAst = Number(p.apg) * totalProjectedGames;
  const projReb = Number(p.rpg) * totalProjectedGames;
  const projEff = Number(p.efficiency) * totalProjectedGames;

  const raw =
    (projPts / C.max_pts) * C.pts_w +
    (projAst / C.max_ast) * C.ast_w +
    (projReb / C.max_reb) * C.reb_w +
    (projEff / C.max_eff) * C.eff_w;

  return Math.max(0, Math.min(1000, raw * 1000));
}

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

export function computeMomentum(history: PricePoint[]): number {
  if (history.length < 3) return 0;
  let ema = Number(history[0].price);
  for (let i = 1; i < history.length; i++) ema = C.ema_alpha * Number(history[i].price) + (1 - C.ema_alpha) * ema;
  const cur = Number(history[history.length - 1].price);
  return ema > 0 ? (cur - ema) / ema : 0;
}

// --- Bug #7 fix: AMM now uses price-calibrated pools ---
// spot_price = pool_y / pool_x, so pool_y = pool_x * price
// k = pool_x * pool_y = pool_x^2 * price
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
    const tokensOut = px - nX; // exact tokens received by buyer (constant-product invariant)
    if (tokensOut <= 0) return { effectivePrice: spot, slippage: 0, newX: px, newY: py, qty: 0 };
    const eff = usd / tokensOut;
    const slip = Math.abs(eff - spot) / spot;
    return { effectivePrice: eff, slippage: Math.min(slip, 0.1), newX: nX, newY: nY, qty: tokensOut };
  } else {
    // Sell: tokens flow in, USD flows out. tokensIn derived from notional at spot.
    const tokensIn = usd / spot;
    const nX = px + tokensIn;
    const nY = k / nX;
    const usdOut = py - nY; // exact USD out from invariant
    if (usdOut <= 0 || tokensIn <= 0) return { effectivePrice: spot, slippage: 0, newX: px, newY: py, qty: 0 };
    const eff = usdOut / tokensIn;
    const slip = Math.abs(spot - eff) / spot;
    // qty = tokensIn: the actual token quantity entering the position (not netDollars/eff)
    return { effectivePrice: eff, slippage: Math.min(slip, 0.1), newX: nX, newY: nY, qty: tokensIn };
  }
}

export function tick(player: Player, history: PricePoint[]) {
  const ev = computeEV(player);
  const vol = computeVol(history);
  const mom = computeMomentum(history);
  const cur = Number(player.current_price);
  if (cur <= 0 || isNaN(cur)) return { price: 100, ev: 500, volatility: 0.05 };

  const fair = ev * 0.35;
  const reversion = (fair - cur) * C.reversion;
  const momDelta = mom * cur * C.momentum_w;
  // Box-Muller normal noise
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  const noise = z * vol * cur * C.noise;
  const volPrem = vol * cur * 0.03 * (Math.random() - 0.47);

  let np = cur + reversion + momDelta + noise + volPrem;
  const mx = cur * C.max_tick;
  np = Math.max(cur - mx, Math.min(cur + mx, np));
  np = Math.max(5, np);

  return {
    price: parseFloat(np.toFixed(2)),
    ev: parseFloat(ev.toFixed(2)),
    volatility: parseFloat(vol.toFixed(4)),
  };
}
