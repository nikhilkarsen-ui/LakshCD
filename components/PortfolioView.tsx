'use client';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Card, Label, Avatar, Badge, Skel, fmt, fmtPct } from './ui';
import { usePortfolio } from '@/hooks';
import { Player } from '@/types';

const PIE = ['#00d4aa','#3b82f6','#8b5cf6','#f59e0b','#ff4757','#06b6d4','#ec4899'];

export default function PortfolioView({ onSelect }: { onSelect: (p: Player) => void }) {
  const { portfolio, loading } = usePortfolio();

  if (loading || !portfolio) return (
    <div className="p-4 space-y-3">
      <Skel className="h-36 w-full"/><Skel className="h-24 w-full"/><Skel className="h-44 w-full"/>
    </div>
  );

  const positions = portfolio.positions || [];
  const margin = portfolio.margin;
  const pos = portfolio.total_pnl >= 0;
  const dailyPos = portfolio.daily_pnl >= 0;

  return (
    <div className="p-4 animate-fade-in space-y-3">

      {/* Portfolio value card */}
      <Card className="bg-gradient-to-br from-lk-card to-[#0f1a2e]">
        <div className="text-[11px] text-lk-dim tracking-wider uppercase mb-1">Total Portfolio Value</div>
        <div className="text-3xl font-bold">{fmt(portfolio.total_value)}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-center mt-1.5">
          <span className={`text-sm font-semibold ${pos?'text-lk-accent':'text-lk-red'}`}>
            {pos?'+':''}{fmt(portfolio.total_pnl)} ({fmtPct(portfolio.total_pnl_pct)})
          </span>
          <span className="text-xs text-lk-dim">All Time</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-lk-border/50">
          <div>
            <div className="text-[10px] text-lk-dim">Cash</div>
            <div className="text-sm font-semibold">{fmt(portfolio.cash_balance)}</div>
          </div>
          <div>
            <div className="text-[10px] text-lk-dim">Open P&L</div>
            <div className={`text-sm font-semibold ${portfolio.positions_value>=0?'text-lk-accent':'text-lk-red'}`}>
              {portfolio.positions_value>=0?'+':''}{fmt(portfolio.positions_value)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-lk-dim">Today's MTM</div>
            <div className={`text-sm font-semibold ${dailyPos?'text-lk-accent':'text-lk-red'}`}>
              {dailyPos?'+':''}{fmt(portfolio.daily_pnl ?? 0)}
            </div>
          </div>
        </div>
      </Card>

      {/* Margin & Risk */}
      {margin && margin.total_notional > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <Label>Margin & Risk</Label>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
              margin.health==='safe'?'bg-lk-accent-dim text-lk-accent':
              margin.health==='warning'?'bg-yellow-500/15 text-yellow-400':
              'bg-lk-red-dim text-lk-red'}`}>
              {margin.health}
            </span>
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-lk-dim">Margin Usage</span>
              <span className="font-mono font-semibold">{margin.margin_usage_pct.toFixed(1)}%</span>
            </div>
            <div className="h-2.5 bg-lk-border rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${
                margin.health==='safe'?'bg-gradient-to-r from-lk-accent to-emerald-400':
                margin.health==='warning'?'bg-yellow-400':'bg-lk-red'}`}
                style={{width:`${Math.min(100,margin.margin_usage_pct)}%`}}/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-lk-dim">Equity</span><span className="font-semibold">{fmt(margin.equity)}</span></div>
            <div className="flex justify-between"><span className="text-lk-dim">Notional</span><span className="font-semibold">{fmt(margin.total_notional)}</span></div>
            <div className="flex justify-between"><span className="text-lk-dim">Initial Margin (50%)</span><span className="font-semibold">{fmt(margin.required_margin)}</span></div>
            <div className="flex justify-between"><span className="text-lk-dim">Available</span><span className="font-semibold text-lk-accent">{fmt(margin.margin_available)}</span></div>
          </div>
          {margin.health === 'warning' && <div className="mt-3 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">⚠ Low margin — consider reducing positions.</div>}
          {margin.health === 'liquidation' && <div className="mt-3 p-2 rounded-lg bg-lk-red/10 border border-lk-red/20 text-xs text-lk-red">🚨 Liquidation imminent — close positions now.</div>}
        </Card>
      )}

      {/* Allocation pie */}
      {positions.length > 0 && (
        <Card>
          <Label>Allocation</Label>
          <div className="flex items-center gap-4">
            <div className="w-28 h-28 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={positions.map((p:any) => ({name:p.player?.name?.split(' ').pop(),value:Math.abs(p.notional)}))}
                    dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={2}>
                    {positions.map((_:any,i:number) => <Cell key={i} fill={PIE[i%PIE.length]}/>)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {positions.map((p:any,i:number) => {
                const tot = positions.reduce((s:number,x:any) => s+Math.abs(x.notional),0);
                return (
                  <div key={p.player_id} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:PIE[i%PIE.length]}}/>
                    <span className="flex-1 truncate">{p.player?.name}</span>
                    <Badge positive={p.side==='buy'}/>
                    <span className="text-lk-dim w-10 text-right">{tot>0?((Math.abs(p.notional)/tot)*100).toFixed(0):0}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Open futures positions */}
      <Card>
        <Label>Open Contracts</Label>
        {positions.length === 0 ? (
          <div className="text-center py-8 text-lk-dim text-sm">No open contracts. Go to Market to trade.</div>
        ) : (
          <div>
            {positions.map((p:any, i:number) => (
              <div key={p.player_id}
                onClick={() => p.player && onSelect(p.player)}
                className={`py-3 cursor-pointer hover:bg-lk-hover -mx-4 px-4 transition-colors ${i<positions.length-1?'border-b border-lk-border':''}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={p.player?.name||'?'} i={i}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm truncate">{p.player?.name}</span>
                      <Badge positive={p.side==='buy'}/>
                    </div>
                    <div className="text-[11px] text-lk-dim mt-0.5">
                      {Math.abs(p.position_size).toFixed(2)} contracts · Entry ${(p.avg_entry_price||0).toFixed(2)}
                      {p.last_settlement_price && (
                        <> · Settle <span className="text-lk-text">${Number(p.last_settlement_price).toFixed(2)}</span></>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-semibold text-sm">{fmt(Math.abs(p.notional))}</div>
                    <div className={`text-xs font-medium ${(p.pnl||0)>=0?'text-lk-accent':'text-lk-red'}`}>
                      {(p.pnl||0)>=0?'+':''}{fmt(p.pnl||0)}
                    </div>
                  </div>
                </div>
                {/* Daily MTM row */}
                <div className="flex gap-4 mt-1.5 ml-10 text-[11px]">
                  <span className="text-lk-dim">Today's MTM:</span>
                  <span className={`font-medium ${(p.daily_pnl||0)>=0?'text-lk-accent':'text-lk-red'}`}>
                    {(p.daily_pnl||0)>=0?'+':''}{fmt(p.daily_pnl||0)} ({fmtPct(p.daily_pnl_pct||0)})
                  </span>
                  <span className="text-lk-muted ml-auto">Liq: <span className="text-lk-red">${(p.liq_price||0).toFixed(2)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
