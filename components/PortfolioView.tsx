'use client';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Card, Label, Avatar, Skel, fmt, fmtPct } from './ui';
import { usePortfolio } from '@/hooks';
import { Player } from '@/types';

const PIE = ['#00d4aa','#3b82f6','#8b5cf6','#f59e0b','#ff4757','#06b6d4','#ec4899'];

export default function PortfolioView({ onSelect, onGoToMarket }: { onSelect: (p: Player) => void; onGoToMarket?: () => void }) {
  const { portfolio, loading } = usePortfolio();

  if (loading || !portfolio) return (
    <div className="p-4 space-y-3">
      <Skel className="h-36 w-full"/><Skel className="h-24 w-full"/><Skel className="h-44 w-full"/>
    </div>
  );

  const positions = portfolio.positions || [];
  const totalPos = portfolio.total_pnl >= 0;
  const unrealizedPos = portfolio.unrealized_pnl >= 0;
  const realizedPos = portfolio.realized_pnl >= 0;

  return (
    <div className="p-4 animate-fade-in space-y-3">

      {/* Portfolio value card */}
      <Card className="bg-gradient-to-br from-lk-card to-[#0f1a2e]">
        <div className="text-[11px] text-lk-dim tracking-wider uppercase mb-1">Total Portfolio Value</div>
        <div className="text-3xl font-bold">{fmt(portfolio.total_value)}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-center mt-1.5">
          <span className={`text-sm font-semibold ${totalPos ? 'text-lk-accent' : 'text-lk-red'}`}>
            {totalPos ? '+' : ''}{fmt(portfolio.total_pnl)} ({fmtPct(portfolio.total_pnl_pct)})
          </span>
          <span className="text-xs text-lk-dim">All Time</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-lk-border/50">
          <div>
            <div className="text-[10px] text-lk-dim">Cash</div>
            <div className="text-sm font-semibold">{fmt(portfolio.cash_balance)}</div>
          </div>
          <div>
            <div className="text-[10px] text-lk-dim">Unrealized P&L</div>
            <div className={`text-sm font-semibold ${unrealizedPos ? 'text-lk-accent' : 'text-lk-red'}`}>
              {unrealizedPos ? '+' : ''}{fmt(portfolio.unrealized_pnl)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-lk-dim">Realized P&L</div>
            <div className={`text-sm font-semibold ${realizedPos ? 'text-lk-accent' : 'text-lk-red'}`}>
              {realizedPos ? '+' : ''}{fmt(portfolio.realized_pnl)}
            </div>
          </div>
        </div>
      </Card>

      {/* Allocation pie */}
      {positions.length > 0 && (
        <Card>
          <Label>Allocation</Label>
          <div className="flex items-center gap-4">
            <div className="w-28 h-28 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={positions.map((p: any) => ({ name: p.player?.name?.split(' ').pop(), value: p.market_value || 0 }))}
                    dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={2}>
                    {positions.map((_: any, i: number) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {positions.map((p: any, i: number) => {
                const tot = positions.reduce((s: number, x: any) => s + (x.market_value || 0), 0);
                return (
                  <div key={p.player_id} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE[i % PIE.length] }} />
                    <span className="flex-1 truncate">{p.player?.name}</span>
                    <span className="text-lk-dim w-10 text-right">
                      {tot > 0 ? (((p.market_value || 0) / tot) * 100).toFixed(0) : 0}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Holdings list */}
      <Card>
        <Label>Holdings</Label>
        {positions.length === 0 ? (
          <div className="flex flex-col items-center py-10 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-lk-accent/10 border border-lk-accent/20 flex items-center justify-center mb-4">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#00d4aa" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-lk-text mb-1">No positions yet</div>
            <div className="text-xs text-lk-dim leading-relaxed mb-5">
              Pick a player from the market and buy your first shares.<br />Your holdings will appear here.
            </div>
            {onGoToMarket && (
              <button
                onClick={onGoToMarket}
                className="px-5 py-2.5 rounded-xl bg-lk-accent text-lk-bg text-sm font-semibold hover:bg-lk-accent/90 transition-colors"
              >
                Browse the market
              </button>
            )}
          </div>
        ) : (
          <div>
            {positions.map((p: any, i: number) => (
              <div
                key={p.player_id}
                onClick={() => p.player && onSelect(p.player)}
                className={`py-3 cursor-pointer hover:bg-lk-hover -mx-4 px-4 transition-colors ${i < positions.length - 1 ? 'border-b border-lk-border' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={p.player?.name || '?'} i={i} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{p.player?.name}</div>
                    <div className="text-[11px] text-lk-dim mt-0.5">
                      {Number(p.shares_owned).toFixed(4)} shares · Avg ${Number(p.avg_cost_basis).toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-semibold text-sm">{fmt(p.market_value || 0)}</div>
                    <div className={`text-xs font-medium ${(p.unrealized_pnl || 0) >= 0 ? 'text-lk-accent' : 'text-lk-red'}`}>
                      {(p.unrealized_pnl || 0) >= 0 ? '+' : ''}{fmt(p.unrealized_pnl || 0)}
                      <span className="text-lk-dim font-normal ml-1">({fmtPct(p.unrealized_pnl_pct || 0)})</span>
                    </div>
                  </div>
                </div>
                {/* Realized P&L row */}
                {Number(p.realized_pnl) !== 0 && (
                  <div className="flex gap-4 mt-1.5 ml-10 text-[11px]">
                    <span className="text-lk-dim">Realized:</span>
                    <span className={`font-medium ${Number(p.realized_pnl) >= 0 ? 'text-lk-accent' : 'text-lk-red'}`}>
                      {Number(p.realized_pnl) >= 0 ? '+' : ''}{fmt(Number(p.realized_pnl))}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
