'use client';
import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Player, PricePoint, ChartRange } from '@/types';
import { Card, Label, Skel, Toast, fmt, fmtPct } from './ui';
import { usePlayerDetail, useTrade, usePortfolio } from '@/hooks';
import { SEASON } from '@/config/constants';

export default function PlayerDetail({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [range, setRange] = useState<ChartRange>('1D');
  const [dollars, setDollars] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const { player, priceHistory } = usePlayerDetail(playerId, range);
  const { execute, executing } = useTrade();
  const { portfolio, refetch } = usePortfolio();

  const pos = portfolio?.positions?.find((p: any) => p.player_id === playerId);
  const sharesOwned = pos ? Number(pos.shares_owned) : 0;
  const hasPosition = sharesOwned > 0.0001;

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
    if (!player || !hasPosition) return;
    const result = await execute(player.id, 0, 'sell', true);
    if (result.success) {
      setToast({ msg: `Sold all ${player.name} shares`, type: 'ok' });
      setDollars('');
      refetch();
    } else {
      setToast({ msg: result.error || 'Sell all failed', type: 'err' });
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
  const efv = player.expected_final_value || 0;
  const settled = player.settlement_status === 'settled';

  // Sell validation: how many shares can be sold with the entered dollar amount
  const enteredDollars = parseFloat(dollars) || 0;
  const approxSharesToSell = player.current_price > 0 ? enteredDollars / player.current_price : 0;
  const sellExceedsOwned = approxSharesToSell > sharesOwned + 0.001;
  const maxSellDollars = sharesOwned * player.current_price;

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
        {settled && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase bg-lk-accent-dim text-lk-accent">Settled</span>
        )}
      </div>

      {/* Price + change */}
      <div className="mb-4">
        <div className="text-3xl font-bold">${player.current_price.toFixed(2)}</div>
        <span className={`text-sm font-medium ${up ? 'text-lk-accent' : 'text-lk-red'}`}>
          {up ? '↗' : '↘'} ${Math.abs(player.price_change_24h || 0).toFixed(2)} ({fmtPct(player.price_change_pct_24h || 0)})
        </span>
        <span className="text-xs text-lk-dim ml-1">24h</span>
      </div>

      {/* Market info */}
      <Card className="mb-3 bg-lk-card/60">
        <Label>Market Info</Label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mt-1">
          <div>
            <span className="text-lk-dim">Current Price</span>
            <div className="font-semibold mt-0.5">${player.current_price.toFixed(2)}</div>
          </div>
          <div>
            <span className="text-lk-dim">Expected Final Value</span>
            <div className="font-semibold mt-0.5 text-lk-accent">${efv.toFixed(2)}</div>
          </div>
          <div>
            <span className="text-lk-dim">Season Settlement</span>
            <div className="font-semibold mt-0.5">{settlementDate}</div>
          </div>
          <div>
            <span className="text-lk-dim">Status</span>
            <div className={`font-semibold mt-0.5 ${settled ? 'text-lk-accent' : 'text-lk-text'}`}>
              {settled ? `Settled @ $${(player.final_settlement_price || 0).toFixed(2)}` : 'Trading Active'}
            </div>
          </div>
        </div>
        {!settled && efv > 0 && (
          <div className="mt-2 pt-2 border-t border-lk-border/40 text-[11px] text-lk-dim">
            Price is the market's current estimate of the final settlement value at season end.
            Expected final value is based on season stats.
          </div>
        )}
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
                  formatter={(v: number) => ['$' + v.toFixed(2), 'Price']}
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
          { l: 'Expected Final Value', v: '$' + efv.toFixed(2) },
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

      {/* Your Holdings */}
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

      {/* Trade panel */}
      {!settled ? (
        <Card>
          <Label>Trade</Label>
          <p className="text-[11px] text-lk-dim mb-3">
            Enter dollar amount. Buying shares deducts cash immediately. You can only sell shares you own.
            Remaining shares settle at the final season price on {settlementDate}.
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

          {/* Quick amount buttons */}
          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {[50, 100, 250, 500, 1000].map(a => (
              <button key={a} onClick={() => setDollars(String(a))}
                className="py-2.5 rounded-lg border border-lk-border text-lk-dim text-xs hover:border-lk-muted transition-colors font-medium">
                ${a >= 1000 ? '1K' : a}
              </button>
            ))}
          </div>

          {/* Sell all shortcut — uses exact share count server-side */}
          {hasPosition && (
            <button onClick={doSellAll} disabled={executing}
              className="w-full mb-3 py-2 rounded-lg border border-lk-red/30 text-lk-red text-xs hover:bg-lk-red/5 transition-colors font-medium disabled:opacity-40">
              {executing ? '...' : `Sell all ${sharesOwned.toFixed(4)} shares ≈ ${fmt(maxSellDollars)}`}
            </button>
          )}

          {/* Trade breakdown */}
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
            <button
              onClick={() => doTrade('buy')}
              disabled={executing || !dollars || parseFloat(dollars) <= 0}
              className="py-4 rounded-xl text-sm font-semibold bg-lk-accent text-lk-bg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              {executing ? '...' : '↗ Buy'}
            </button>
            <button
              onClick={() => doTrade('sell')}
              disabled={executing || !dollars || parseFloat(dollars) <= 0 || !hasPosition || sellExceedsOwned}
              className="py-4 rounded-xl text-sm font-semibold bg-lk-red text-white hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              {executing ? '...' : '↘ Sell'}
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
            This player has settled at <span className="text-lk-text font-semibold">${(player.final_settlement_price || 0).toFixed(2)}</span>.
            All remaining shares were automatically converted to cash at the final settlement price.
          </p>
        </Card>
      )}
    </div>
  );
}
