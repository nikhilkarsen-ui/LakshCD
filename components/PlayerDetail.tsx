'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Player, PricePoint, ChartRange } from '@/types';
import { Card, Label, Skel, Toast, fmt, fmtPct } from './ui';
import { usePlayerDetail, useTrade, usePortfolio } from '@/hooks';
import { SEASON } from '@/config/constants';
import {
  getDataForTimeframe,
  timeframePctChange,
  timeframeHighLow,
  type ChartTimeframe,
} from '@/lib/chart-utils';

// ── Synthetic fallback (used when real history is sparse) ─────────────────────
function lcg(seed: number) {
  let s = (seed * 1664525 + 1013904223) & 0xffffffff;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function syntheticHistory(
  currentPrice: number,
  fairValue: number,
  range: ChartRange,
): { t: number; price: number }[] {
  const windowMs: Record<ChartRange, number> = {
    '1H': 3_600_000, '8H': 28_800_000, '24H': 86_400_000,
    '1W': 604_800_000, 'ALL': 7_776_000_000,
  };
  const pts: Record<ChartRange, number> = {
    '1H': 60, '8H': 80, '24H': 100, '1W': 120, 'ALL': 150,
  };
  const n   = pts[range];
  const now = Date.now();
  const w   = windowMs[range];
  const fv  = Math.max(5, fairValue || currentPrice);
  const rand = lcg(Math.round(currentPrice * 100 + fv * 13));

  let price = Math.max(5, fv * (0.72 + rand() * 0.22));
  const raw: { t: number; price: number }[] = [];

  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    const t       = now - w + progress * w;
    const target  = price + (currentPrice - price) * Math.pow(progress, 1.4);
    const drift   = 0.10 * (target - price);
    const vol     = 0.006 * (1 - progress * 0.3);
    const noise   = (rand() - 0.5) * price * vol;
    price = Math.max(5, price + drift + noise);
    raw.push({ t, price });
  }
  raw[raw.length - 1] = { t: now, price: currentPrice };

  // 3-point smooth pass
  return raw.map((pt, i) => {
    if (i === 0 || i === raw.length - 1) return { t: pt.t, price: Math.round(pt.price * 100) / 100 };
    return { t: pt.t, price: Math.round(((raw[i - 1].price + pt.price + raw[i + 1].price) / 3) * 100) / 100 };
  });
}

// ── Tooltip time formatter ────────────────────────────────────────────────────
function fmtTime(ts: number, range: ChartRange): string {
  const d = new Date(ts);
  if (range === '1H')  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '8H')  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '24H') return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '1W')  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

const TIMEFRAMES: ChartRange[] = ['1H', '8H', '24H', '1W', 'ALL'];
const RANGE_LABEL: Record<ChartRange, string> = {
  '1H': '1 hour', '8H': '8 hours', '24H': '24 hours', '1W': '7 days', 'ALL': 'All-time',
};

// ── Custom animated price line tooltip dot ────────────────────────────────────
function LiveDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={color} />
      <circle cx={cx} cy={cy} r={7} fill={color} fillOpacity={0.25} />
    </g>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PlayerDetail({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [range, setRange]     = useState<ChartRange>('24H');
  const [dollars, setDollars] = useState('');
  const [toast, setToast]     = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [isLive, setIsLive]   = useState(false);
  const autoRangedRef         = useRef(false);

  const { player, priceHistory } = usePlayerDetail(playerId, range);
  const { execute, executing }   = useTrade();
  const { portfolio, refetch }   = usePortfolio();

  // ── Detect live game via /api/live-data ──────────────────────────────────
  useEffect(() => {
    fetch('/api/live-data')
      .then(r => r.json())
      .then(d => {
        const live = !!d.hasLiveGames;
        setIsLive(live);
        // Auto-switch to 1H when a game is live — only once per open
        if (live && !autoRangedRef.current) {
          setRange('1H');
          autoRangedRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  // ── Build chart data ──────────────────────────────────────────────────────
  const rawPoints = useMemo(() =>
    priceHistory.map((p: PricePoint) => ({
      t:     new Date(p.created_at).getTime(),
      price: Number(p.price),
    })),
    [priceHistory],
  );

  const chart = useMemo(() => {
    if (!player) return [];
    if (rawPoints.length >= 8) {
      return getDataForTimeframe(rawPoints, range as ChartTimeframe);
    }
    return syntheticHistory(
      player.current_price,
      player.fair_value || player.current_price,
      range,
    );
  }, [rawPoints, player, range]);

  const isSynthetic = rawPoints.length < 8;

  // ── Chart metrics ─────────────────────────────────────────────────────────
  const { hi, lo } = timeframeHighLow(chart);
  const yPad       = Math.max((hi - lo) * 0.08, (player?.current_price ?? 0) * 0.02);

  // For 24H always use the authoritative player field — prevents any discrepancy
  const rangePct = range === '24H'
    ? (player?.price_change_pct_24h ?? 0)
    : timeframePctChange(chart);
  const rangeUp    = rangePct >= 0;
  const chartColor = rangeUp ? '#00d4aa' : '#ff4757';

  // ── Trade helpers ─────────────────────────────────────────────────────────
  const doTrade = async (side: 'buy' | 'sell') => {
    const amt = parseFloat(dollars);
    if (!amt || amt <= 0 || !player) return;
    const result = await execute(player.id, amt, side);
    if (result.success) {
      setToast({ msg: `${side === 'buy' ? 'Bought' : 'Sold'} $${amt.toFixed(2)} of ${player.name}`, type: 'ok' });
      setDollars('');
      refetch();
    } else {
      setToast({ msg: result.error || 'Trade failed', type: 'err' });
    }
  };

  const doSellAll = async () => {
    if (!player || !sharesOwned) return;
    const result = await execute(player.id, 0, 'sell', true);
    if (result.success) {
      setToast({ msg: `Sold all ${player.name} shares`, type: 'ok' });
      setDollars('');
      refetch();
    } else {
      setToast({ msg: result.error || 'Sell all failed', type: 'err' });
    }
  };

  const pos          = portfolio?.positions?.find((p: any) => p.player_id === playerId);
  const sharesOwned  = pos ? Number(pos.shares_owned) : 0;
  const hasPosition  = sharesOwned > 0.0001;

  if (!player) return (
    <div className="p-4 space-y-3">
      <Skel className="h-10 w-40" /><Skel className="h-56 w-full" /><Skel className="h-32 w-full" />
    </div>
  );

  const settled        = player.settlement_status === 'settled';
  const efv            = player.expected_final_value || 0;
  const settlementDate = new Date(SEASON.settlement_date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  const enteredDollars   = parseFloat(dollars) || 0;
  const approxSharesSell = player.current_price > 0 ? enteredDollars / player.current_price : 0;
  const sellExceedsOwned = approxSharesSell > sharesOwned + 0.001;
  const maxSellDollars   = sharesOwned * player.current_price;

  return (
    <div className="animate-fade-in px-4 pb-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Header ── */}
      <div className="flex items-center gap-3 py-4 cursor-pointer" onClick={onBack}>
        <svg width="20" height="20" fill="none" stroke="#e2e8f0" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-base leading-tight">{player.name}</span>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                LIVE
              </span>
            )}
            {player.injury_status && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/25">
                {player.injury_status}
              </span>
            )}
          </div>
          <div className="text-xs text-lk-dim">{player.team} · {player.position}</div>
        </div>
        {settled && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase bg-lk-accent-dim text-lk-accent">
            Settled
          </span>
        )}
      </div>

      {/* ── Price + range change ── */}
      <div className="mb-4">
        <div className="text-3xl font-bold tracking-tight mb-0.5">
          ${player.current_price.toFixed(2)}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${rangeUp ? 'text-lk-accent' : 'text-lk-red'}`}>
            {rangeUp ? '▲' : '▼'} {rangeUp ? '+' : ''}{rangePct.toFixed(2)}%
          </span>
          <span className="text-xs text-lk-dim">{RANGE_LABEL[range]}</span>
          {isSynthetic && <span className="text-[10px] text-lk-dim/60">est.</span>}
        </div>
      </div>

      {/* ── Timeframe selector ── */}
      <div className="flex gap-1.5 mb-0 overflow-x-auto pb-1">
        {TIMEFRAMES.map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex-shrink-0 ${
              range === r
                ? 'border-lk-accent bg-lk-accent-dim text-lk-accent'
                : 'border-lk-border text-lk-dim hover:border-lk-muted'
            }`}
          >
            {r}
            {r === '1H' && isLive && (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-red-400 inline-block align-middle" />
            )}
          </button>
        ))}
      </div>

      {/* ── Chart ── */}
      <Card className="p-0 overflow-hidden mb-3 mt-3">
        <div className="h-52 px-2 pt-3 pb-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${playerId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={chartColor} stopOpacity={0.20} />
                  <stop offset="75%"  stopColor={chartColor} stopOpacity={0.05} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis domain={[Math.max(0, lo - yPad), hi + yPad]} hide />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid #1e2a3a',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#e2e8f0',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                }}
                labelFormatter={(v: number) => fmtTime(v, range)}
                formatter={(v: number) => ['$' + v.toFixed(2), 'Price']}
                cursor={{ stroke: chartColor, strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area
                type="monotoneX"
                dataKey="price"
                stroke={chartColor}
                strokeWidth={2}
                fill={`url(#grad-${playerId})`}
                dot={false}
                activeDot={<LiveDot color={chartColor} />}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* OHLC strip */}
        <div className="flex justify-between px-4 py-2 border-t border-lk-border/40 text-[11px]">
          <span className="text-lk-dim">
            O <span className="text-lk-text font-medium">${(chart[0]?.price ?? player.current_price).toFixed(2)}</span>
          </span>
          <span className="text-lk-dim">
            H <span className="text-lk-accent font-medium">${hi.toFixed(2)}</span>
          </span>
          <span className="text-lk-dim">
            L <span className="text-lk-red font-medium">${lo.toFixed(2)}</span>
          </span>
          <span className="text-lk-dim">
            C <span className="text-lk-text font-medium">${player.current_price.toFixed(2)}</span>
          </span>
        </div>
      </Card>

      {/* ── Market info ── */}
      <Card className="mb-3">
        <Label>Market Info</Label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs mt-1">
          <div>
            <div className="text-lk-dim">Current Price</div>
            <div className="font-semibold mt-0.5">${player.current_price.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-lk-dim">Expected Final Value</div>
            <div className="font-semibold mt-0.5 text-lk-accent">${efv.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-lk-dim">Settlement Date</div>
            <div className="font-semibold mt-0.5">{settlementDate}</div>
          </div>
          <div>
            <div className="text-lk-dim">Status</div>
            <div className={`font-semibold mt-0.5 ${settled ? 'text-lk-accent' : isLive ? 'text-red-400' : player.injury_status ? 'text-orange-400' : 'text-lk-text'}`}>
              {settled
                ? `Settled @ $${(player.final_settlement_price || 0).toFixed(2)}`
                : isLive
                ? '🔴 Game Live'
                : player.injury_status ?? 'Active'}
            </div>
          </div>
          {player.injury_description && (
            <div className="col-span-2">
              <div className="text-lk-dim">Injury</div>
              <div className="font-medium mt-0.5 text-orange-300/80">{player.injury_description}</div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Season stats ── */}
      <Card className="mb-3">
        <Label>Season Stats</Label>
        <div className="grid grid-cols-4 gap-2 mt-1">
          {[
            { l: 'PPG', v: player.ppg },
            { l: 'APG', v: player.apg },
            { l: 'RPG', v: player.rpg },
            { l: 'EFF', v: player.efficiency },
          ].map(s => (
            <div key={s.l} className="text-center">
              <div className="text-lg font-bold text-lk-accent">{(s.v || 0).toFixed(1)}</div>
              <div className="text-[10px] text-lk-dim uppercase tracking-wide">{s.l}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Holdings ── */}
      {hasPosition && pos && (
        <Card className="mb-3">
          <Label>Your Holdings</Label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm mt-1">
            <div>
              <div className="text-[11px] text-lk-dim">Shares Owned</div>
              <div className="font-semibold">{sharesOwned.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Avg Cost</div>
              <div className="font-semibold">${(pos.avg_cost_basis || 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Market Value</div>
              <div className="font-semibold">{fmt(pos.market_value || 0)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Unrealized P&L</div>
              <div className={`font-semibold ${(pos.unrealized_pnl || 0) >= 0 ? 'text-lk-accent' : 'text-lk-red'}`}>
                {(pos.unrealized_pnl || 0) >= 0 ? '+' : ''}{fmt(pos.unrealized_pnl || 0)}
                <span className="text-xs font-normal ml-1">({fmtPct(pos.unrealized_pnl_pct || 0)})</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Realized P&L</div>
              <div className={`font-semibold ${(pos.realized_pnl || 0) >= 0 ? 'text-lk-accent' : 'text-lk-red'}`}>
                {(pos.realized_pnl || 0) >= 0 ? '+' : ''}{fmt(pos.realized_pnl || 0)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Expected Final Value</div>
              <div className="font-semibold text-lk-accent">${efv.toFixed(2)}</div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Trade panel ── */}
      {!settled ? (
        <Card>
          <Label>Trade</Label>
          <p className="text-[11px] text-lk-dim mb-3">
            Enter dollar amount. Unsold shares settle at the final price on {settlementDate}.
          </p>
          <div className="relative mb-3">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lk-dim text-sm">$</span>
            <input
              type="number" inputMode="decimal" placeholder="Amount"
              value={dollars} onChange={e => setDollars(e.target.value)}
              className="w-full pl-8 pr-4 py-3.5 rounded-xl border border-lk-border bg-lk-bg/80 text-lk-text text-base outline-none focus:border-lk-accent/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {[50, 100, 250, 500, 1000].map(a => (
              <button key={a} onClick={() => setDollars(String(a))}
                className="py-2.5 rounded-lg border border-lk-border text-lk-dim text-xs hover:border-lk-muted transition-colors font-medium">
                ${a >= 1000 ? '1K' : a}
              </button>
            ))}
          </div>

          {hasPosition && (
            <button onClick={doSellAll} disabled={executing}
              className="w-full mb-3 py-2 rounded-lg border border-lk-red/30 text-lk-red text-xs hover:bg-lk-red/5 transition-colors font-medium disabled:opacity-40">
              {executing ? '...' : `Sell all ${sharesOwned.toFixed(4)} shares ≈ ${fmt(maxSellDollars)}`}
            </button>
          )}

          {enteredDollars > 0 && (
            <div className="p-3 rounded-lg bg-lk-accent/5 border border-lk-accent/10 mb-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-lk-dim">Est. Shares</span>
                <span>{(enteredDollars / player.current_price).toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-lk-dim">Fee (0.1%)</span>
                <span>${(enteredDollars * 0.001).toFixed(2)}</span>
              </div>
              {sellExceedsOwned && (
                <div className="text-lk-red font-medium pt-1">
                  Exceeds your holdings ({sharesOwned.toFixed(4)} shares ≈ {fmt(maxSellDollars)})
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => doTrade('buy')}
              disabled={executing || !dollars || parseFloat(dollars) <= 0}
              className="py-4 rounded-xl text-sm font-semibold bg-lk-accent text-lk-bg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              {executing ? '...' : '▲ Buy'}
            </button>
            <button onClick={() => doTrade('sell')}
              disabled={executing || !dollars || parseFloat(dollars) <= 0 || !hasPosition || sellExceedsOwned}
              className="py-4 rounded-xl text-sm font-semibold bg-lk-red text-white hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              {executing ? '...' : '▼ Sell'}
            </button>
          </div>
          {!hasPosition && (
            <p className="text-center text-[11px] text-lk-dim mt-2">You have no shares to sell.</p>
          )}
        </Card>
      ) : (
        <Card>
          <Label>Settlement</Label>
          <p className="text-sm text-lk-dim">
            This player settled at{' '}
            <span className="text-lk-text font-semibold">${(player.final_settlement_price || 0).toFixed(2)}</span>.
            All shares were converted to cash at the final settlement price.
          </p>
        </Card>
      )}
    </div>
  );
}
