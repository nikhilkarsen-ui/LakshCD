// ============================================================
// LAKSH — Chart Data Processing
//
// getDataForTimeframe(rawData, timeframe) is the main entry point.
// It filters, downsamples with LTTB, and smooths with bidirectional
// EMA — all tuned per timeframe so every view looks correct.
//
// Downsampling algorithm: LTTB (Largest-Triangle-Three-Buckets)
//   Selects the most visually important points from a dense series.
//   Preserves peaks, troughs and inflections — discards flat runs.
//   Industry standard used by Grafana, Highcharts, Dygraphs.
//
// Smoothing algorithm: bidirectional EMA
//   Forward pass + backward pass averaged — eliminates the lag that
//   a forward-only EMA introduces. No artificial phase shift.
// ============================================================

export type ChartTimeframe = '1H' | '8H' | '24H' | '1W' | 'ALL';

export interface ChartPoint {
  t:     number;   // unix ms timestamp
  price: number;
}

// ── Per-timeframe config ──────────────────────────────────────────────────────
const CONFIG: Record<ChartTimeframe, {
  windowMs:     number;   // how far back to look
  targetPoints: number;   // display-point budget after LTTB
  emaAlpha:     number;   // EMA smoothing factor (1.0 = no smooth, lower = smoother)
}> = {
  '1H':  { windowMs: 1  * 3_600_000,  targetPoints: 120, emaAlpha: 1.00 }, // raw — preserve every wiggle
  '8H':  { windowMs: 8  * 3_600_000,  targetPoints: 160, emaAlpha: 0.55 }, // light
  '24H': { windowMs: 24 * 3_600_000,  targetPoints: 200, emaAlpha: 0.35 }, // moderate
  '1W':  { windowMs: 7  * 86_400_000, targetPoints: 200, emaAlpha: 0.18 }, // strong
  'ALL': { windowMs: Infinity,         targetPoints: 200, emaAlpha: 0.10 }, // heavy
};

// ── LTTB Downsampling ─────────────────────────────────────────────────────────
// https://skemman.is/bitstream/1946/15343/3/SS_MSthesis.pdf
// O(n) — fast enough for real-time use.
function lttb(data: ChartPoint[], threshold: number): ChartPoint[] {
  const n = data.length;
  if (threshold <= 0 || n <= threshold) return data;

  const sampled: ChartPoint[] = [data[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // Next bucket: compute centroid for triangle base
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    let avgT = 0, avgP = 0;
    const nextCount = nextEnd - nextStart;
    for (let j = nextStart; j < nextEnd; j++) { avgT += data[j].t; avgP += data[j].price; }
    avgT /= nextCount; avgP /= nextCount;

    // Current bucket: pick the point that forms the largest triangle
    const curStart = Math.floor(i * bucketSize) + 1;
    const curEnd   = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
    let maxArea = -1, maxIdx = curStart;
    const ptA = data[a];

    for (let j = curStart; j < curEnd; j++) {
      const area = Math.abs(
        (ptA.t - avgT) * (data[j].price - ptA.price) -
        (ptA.t - data[j].t) * (avgP - ptA.price),
      ) * 0.5;
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }

    sampled.push(data[maxIdx]);
    a = maxIdx;
  }

  sampled.push(data[n - 1]);
  return sampled;
}

// ── Bidirectional EMA ─────────────────────────────────────────────────────────
// Forward pass then backward pass, averaged — zero phase-lag smoothing.
// alpha=1.0 → identity (no change); alpha=0.1 → heavy smoothing.
function biEma(data: ChartPoint[], alpha: number): ChartPoint[] {
  if (alpha >= 1.0 || data.length < 3) return data;

  // Forward pass
  const fwd = data.map(d => ({ ...d }));
  for (let i = 1; i < fwd.length; i++) {
    fwd[i].price = alpha * fwd[i].price + (1 - alpha) * fwd[i - 1].price;
  }

  // Backward pass
  const bwd = data.map(d => ({ ...d }));
  for (let i = bwd.length - 2; i >= 0; i--) {
    bwd[i].price = alpha * bwd[i].price + (1 - alpha) * bwd[i + 1].price;
  }

  // Average forward and backward — preserves endpoints exactly
  return data.map((_, i) => ({
    t:     data[i].t,
    price: Math.round(((fwd[i].price + bwd[i].price) / 2) * 100) / 100,
  }));
}

// ── Main entry point ──────────────────────────────────────────────────────────
export function getDataForTimeframe(
  raw:       ChartPoint[],
  timeframe: ChartTimeframe,
): ChartPoint[] {
  if (!raw.length) return [];

  const { windowMs, targetPoints, emaAlpha } = CONFIG[timeframe];

  // 1. Filter to time window
  const cutoff  = windowMs === Infinity ? 0 : Date.now() - windowMs;
  const inWindow = raw.filter(d => d.t >= cutoff);
  if (!inWindow.length) return [];

  // 2. LTTB downsample to display budget
  const downsampled = lttb(inWindow, targetPoints);

  // 3. Bidirectional EMA smoothing
  return biEma(downsampled, emaAlpha);
}

// ── Derived metrics ────────────────────────────────────────────────────────────
export function timeframePctChange(data: ChartPoint[]): number {
  if (data.length < 2) return 0;
  const open  = data[0].price;
  const close = data[data.length - 1].price;
  return open > 0 ? ((close - open) / open) * 100 : 0;
}

export function timeframeHighLow(data: ChartPoint[]): { hi: number; lo: number } {
  if (!data.length) return { hi: 0, lo: 0 };
  return {
    hi: Math.max(...data.map(d => d.price)),
    lo: Math.min(...data.map(d => d.price)),
  };
}
