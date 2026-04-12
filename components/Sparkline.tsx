'use client';
import { memo, useId, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SparkPoint { price: number }

interface Props {
  data: SparkPoint[];
  /** Override trend color (else derived from first→last price) */
  isPositive?: boolean;
  width?: number;
  height?: number;
}

const W = 96;
const H = 36;
// Inset so the end-dot and stroke don't clip at the SVG edge
const PX = 3;
const PY = 4;

// ─── Smooth cubic-bezier path ─────────────────────────────────────────────────
// Each segment uses the horizontal midpoint as both control points.
// C1-continuous, passes through every data point.
function buildLinePath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
export const Sparkline = memo(function Sparkline({
  data,
  isPositive,
  width  = W,
  height = H,
}: Props) {
  const uid = useId().replace(/:/g, '');

  const result = useMemo(() => {
    const prices = (data ?? []).map(d => d.price).filter(p => p > 0 && isFinite(p));
    if (prices.length < 2) return null;

    const first = prices[0];
    const last  = prices[prices.length - 1];
    const up    = isPositive ?? (last >= first);
    const color = up ? '#00d4aa' : '#ff4757';

    const minP  = Math.min(...prices);
    const maxP  = Math.max(...prices);
    const range = maxP - minP;

    const uw = width  - PX * 2;
    const uh = height - PY * 2;

    const pts: [number, number][] = prices.map((p, i) => [
      PX + (i / (prices.length - 1)) * uw,
      range === 0
        ? PY + uh / 2                           // flat → centre
        : PY + (1 - (p - minP) / range) * uh,
    ]);

    const linePath = buildLinePath(pts);
    const [lx, ly]  = pts[pts.length - 1];
    const areaPath  = `${linePath} L${lx.toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;

    return { linePath, areaPath, color, endX: lx, endY: ly };
  }, [data, isPositive, width, height]);

  // ── Flat / empty fallback ──────────────────────────────────────────────────
  if (!result) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1={PX} y1={height / 2} x2={width - PX} y2={height / 2}
          stroke="#334155" strokeWidth="1.5" strokeLinecap="round"
        />
      </svg>
    );
  }

  const { linePath, areaPath, color, endX, endY } = result;
  const gId = `spk_${uid}`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <defs>
        {/* Vertical gradient: color → transparent */}
        <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </linearGradient>
      </defs>

      {/* Fill under the line */}
      <path d={areaPath} fill={`url(#${gId})`} />

      {/* The line itself */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Current-price dot */}
      <circle cx={endX} cy={endY} r="2.2" fill={color} />
    </svg>
  );
});
