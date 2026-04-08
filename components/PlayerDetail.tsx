'use client';
import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Player, PricePoint, ChartRange } from '@/types';
import { Card, Label, Badge, Skel, Toast, fmt, fmtPct } from './ui';
import { usePlayerDetail, useTrade, usePortfolio } from '@/hooks';
import { SEASON } from '@/config/constants';

// Contract specification — 1 contract = $1 notional/point, settlement on season end
const CONTRACT_MULTIPLIER = 1;

export default function PlayerDetail({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [range, setRange] = useState<ChartRange>('1D');
  const [dollars, setDollars] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const { player, priceHistory } = usePlayerDetail(playerId, range);
  const { execute, executing } = useTrade();
  const { portfolio, refetch } = usePortfolio();

  const pos = portfolio?.positions?.find((p: any) => p.player_id === playerId);
  const posSize = pos?.position_size || 0;
  const isLong = posSize > 0.0001;
  const isShort = posSize < -0.0001;
  const hasPosition = isLong || isShort;

  const doTrade = async (sign: number) => {
    const amt = parseFloat(dollars);
    if (!amt || amt <= 0 || !player) return;
    const result = await execute(player.id, amt * sign);
    if (result.success) {
      setToast({ msg: `${sign > 0 ? 'Buy' : 'Sell'} ${player.name} for $${amt.toFixed(2)}`, type: 'ok' });
      setDollars('');
      refetch();
    } else {
      setToast({ msg: result.error || 'Trade failed', type: 'err' });
    }
  };

  if (!player) return (
    <div className="p-4 space-y-3">
      <Skel className="h-10 w-40" /><Skel className="h-48 w-full" /><Skel className="h-32 w-full" />
    </div>
  );

  const chart = priceHistory.map((p: PricePoint) => ({ t: new Date(p.created_at).getTime(), price: p.price }));
  const hi = chart.length ? Math.max(...chart.map(d => d.price)) : player.current_price;
  const lo = chart.length ? Math.min(...chart.map(d => d.price)) : player.current_price;
  const up = (player.price_change_pct_24h || 0) >= 0;
  const settlementDate = new Date(SEASON.settlement_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="animate-fade-in px-4 pb-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center gap-3 py-4 cursor-pointer" onClick={onBack}>
        <svg width="20" height="20" fill="none" stroke="#e2e8f0" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        <div className="flex-1">
          <div className="font-bold text-base leading-tight">{player.name}</div>
          <div className="text-xs text-lk-dim">{player.team} · {player.position}</div>
        </div>
        {hasPosition && <Badge positive={isLong} />}
      </div>

      {/* Price + change */}
      <div className="mb-4">
        <div className="text-3xl font-bold">${player.current_price.toFixed(2)}</div>
        <span className={`text-sm font-medium ${up ? 'text-lk-accent' : 'text-lk-red'}`}>
          {up ? '↗' : '↘'} ${Math.abs(player.price_change_24h || 0).toFixed(2)} ({fmtPct(player.price_change_pct_24h || 0)})
        </span>
        <span className="text-xs text-lk-dim ml-1">24h</span>
      </div>

      {/* Contract Spec */}
      <Card className="mb-3 bg-lk-card/60">
        <Label>Contract Specification</Label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mt-1">
          <div><span className="text-lk-dim">Underlying</span><div className="font-semibold mt-0.5">{player.name}</div></div>
          <div><span className="text-lk-dim">Multiplier</span><div className="font-semibold mt-0.5">${CONTRACT_MULTIPLIER} / contract</div></div>
          <div><span className="text-lk-dim">Settlement</span><div className="font-semibold mt-0.5">{settlementDate}</div></div>
          <div><span className="text-lk-dim">Mark-to-Market</span><div className="font-semibold mt-0.5 text-lk-accent">Daily</div></div>
          <div><span className="text-lk-dim">Initial Margin</span><div className="font-semibold mt-0.5">50% of notional</div></div>
          <div><span className="text-lk-dim">Maint. Margin</span><div className="font-semibold mt-0.5">25% of notional</div></div>
        </div>
      </Card>

      {/* Range selector */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
        {(['1D', '1W', '1M', '3M', 'ALL'] as ChartRange[]).map(r => (
          <button key={r} onClick={() => setRange(r)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex-shrink-0 ${range === r ? 'border-lk-accent bg-lk-accent-dim text-lk-accent' : 'border-lk-border text-lk-dim'}`}>
            {r}
          </button>
        ))}
      </div>

      {/* Chart */}
      <Card className="p-0 overflow-hidden mb-3">
        <div className="h-52 px-2 pt-4">
          {chart.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00d4aa" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#00d4aa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
                  labelFormatter={v => new Date(v).toLocaleTimeString()}
                  formatter={(v: number) => ['$' + v.toFixed(2), 'Mark Price']}
                />
                <Area type="monotone" dataKey="price" stroke="#00d4aa" strokeWidth={2} fill="url(#g)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-lk-dim text-sm">Loading chart...</div>}
        </div>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        {[
          { l: '24h High', v: '$' + hi.toFixed(2) },
          { l: '24h Low', v: '$' + lo.toFixed(2) },
          { l: 'Expected Value', v: (player.expected_value || 0).toFixed(1) },
          { l: 'Volatility', v: ((player.volatility || 0) * 100).toFixed(2) + '%' },
        ].map(s => (
          <Card key={s.l}><div className="text-[11px] text-lk-dim mb-1">{s.l}</div><div className="text-base font-semibold">{s.v}</div></Card>
        ))}
      </div>

      {/* Performance */}
      <Card className="mb-3">
        <Label>Performance</Label>
        <div className="grid grid-cols-4 gap-2">
          {[{ l: 'PPG', v: player.ppg }, { l: 'APG', v: player.apg }, { l: 'RPG', v: player.rpg }, { l: 'EFF', v: player.efficiency }].map(s => (
            <div key={s.l} className="text-center">
              <div className="text-lg font-bold text-lk-accent">{(s.v || 0).toFixed(1)}</div>
              <div className="text-[10px] text-lk-dim">{s.l}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Your Position */}
      {hasPosition && pos && (
        <Card className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <Label>Your Contract Position</Label>
            <Badge positive={isLong} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <div>
              <div className="text-[11px] text-lk-dim">Contracts</div>
              <div className="font-semibold">{Math.abs(posSize).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Entry Price</div>
              <div className="font-semibold">${(pos.avg_entry_price || 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Notional Value</div>
              <div className="font-semibold">{fmt(pos.notional || 0)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Total P&L</div>
              <div className={`font-semibold ${(pos.pnl || 0) >= 0 ? 'text-lk-accent' : 'text-lk-red'}`}>
                {(pos.pnl || 0) >= 0 ? '+' : ''}{fmt(pos.pnl || 0)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Today's MTM P&L</div>
              <div className={`font-semibold ${(pos.daily_pnl || 0) >= 0 ? 'text-lk-accent' : 'text-lk-red'}`}>
                {(pos.daily_pnl || 0) >= 0 ? '+' : ''}{fmt(pos.daily_pnl || 0)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Last Settle</div>
              <div className="font-semibold">
                {pos.last_settlement_price !== null && pos.last_settlement_price !== undefined
                  ? '$' + Number(pos.last_settlement_price).toFixed(2)
                  : <span className="text-lk-dim text-xs">Pending</span>}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Liq. Price</div>
              <div className="font-semibold text-lk-red">${(pos.liq_price || 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] text-lk-dim">Margin Held</div>
              <div className="font-semibold">{fmt(pos.locked_margin || (pos.notional || 0) * 0.5)}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Trade panel */}
      <Card>
        <Label>Trade Futures</Label>
        <p className="text-[11px] text-lk-dim mb-3">
          Enter dollar amount. 50% held as initial margin. Daily mark-to-market settles variation margin to your cash.
          Buy = profit when price rises. Sell = profit when price falls.
        </p>
        <div className="relative mb-3">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lk-dim text-sm">$</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Amount"
            value={dollars}
            onChange={e => setDollars(e.target.value)}
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
        {dollars && parseFloat(dollars) > 0 && (
          <div className="p-3 rounded-lg bg-lk-accent/5 border border-lk-accent/10 mb-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-lk-dim">Est. Contracts</span>
              <span>{(parseFloat(dollars) / player.current_price).toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-lk-dim">Initial Margin (50%)</span>
              <span>${(parseFloat(dollars) * 0.5).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-lk-dim">Fee (0.1%)</span>
              <span>${(parseFloat(dollars) * 0.001).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-lk-border/40 pt-1.5 mt-1">
              <span className="text-lk-dim">Total Deducted</span>
              <span>${(parseFloat(dollars) * 0.501).toFixed(2)}</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => doTrade(1)}
            disabled={executing || !dollars || parseFloat(dollars) <= 0}
            className="py-4 rounded-xl text-sm font-semibold bg-lk-accent text-lk-bg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
            {executing ? '...' : '↗ Buy'}
          </button>
          <button
            onClick={() => doTrade(-1)}
            disabled={executing || !dollars || parseFloat(dollars) <= 0}
            className="py-4 rounded-xl text-sm font-semibold bg-lk-red text-white hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
            {executing ? '...' : '↘ Sell'}
          </button>
        </div>
      </Card>
    </div>
  );
}
