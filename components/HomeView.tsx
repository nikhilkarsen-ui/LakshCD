'use client';
import { useState, useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Player } from '@/types';
import { Card, Avatar, Label, Skel, fmtCompact, fmtPct } from './ui';

export default function HomeView({ players, marketCap, loading, onSelect }: { players: Player[]; marketCap: number; loading: boolean; onSelect: (p: Player) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => !q ? players : players.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.team.toLowerCase().includes(q.toLowerCase())), [players, q]);

  if (loading) return <div className="p-4 space-y-3">{Array.from({length:8}).map((_,i) => <Skel key={i} className="h-16 w-full"/>)}</div>;

  return (
    <div className="animate-fade-in">
      <div className="mx-4 mt-4 mb-3">
        <div className="flex items-center gap-2 bg-lk-card border border-lk-border rounded-xl px-4 py-2.5">
          <svg width="16" height="16" fill="none" stroke="#64748b" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input type="text" placeholder="Search athletes, teams..." value={q} onChange={e => setQ(e.target.value)} className="flex-1 bg-transparent border-none text-lk-text text-sm outline-none placeholder:text-lk-muted"/>
        </div>
      </div>
      <div className="px-4 mb-3">
        <Card className="flex justify-between items-center">
          <div>
            <div className="text-[11px] text-lk-dim tracking-wider uppercase mb-1">Total Market Cap</div>
            <div className="text-2xl font-bold">{fmtCompact(marketCap)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-lk-dim">Players</div>
            <div className="text-sm font-bold text-lk-accent font-mono">{filtered.length}</div>
          </div>
        </Card>
      </div>
      <div className="px-4 mb-2 flex justify-between"><Label>Trending Now</Label><span className="text-xs text-lk-accent">{filtered.length} players</span></div>
      <div className="mx-4 bg-lk-card border border-lk-border rounded-xl overflow-hidden mb-6">
        {filtered.map((p, i) => {
          const pos = (p.price_change_pct_24h || 0) >= 0;
          const spark = Array.from({length:15}, (_, j) => ({ v: p.current_price + Math.sin(j * 0.8 + p.current_price) * p.current_price * (p.volatility || 0.03) * 0.5 }));
          return (
            <div key={p.id} onClick={() => onSelect(p)} className="flex items-center gap-3 px-4 py-3.5 border-b border-lk-border last:border-b-0 cursor-pointer hover:bg-lk-hover transition-colors">
              <Avatar name={p.name} i={i}/>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{p.name}</div>
                <div className="text-xs text-lk-dim">{p.team}</div>
              </div>
              <div className="w-14 h-7 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={spark}><Line type="monotone" dataKey="v" stroke={pos?'#00d4aa':'#ff4757'} strokeWidth={1.5} dot={false}/></LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-right min-w-[80px]">
                <div className="font-semibold text-sm">${p.current_price.toFixed(2)}</div>
                <div className={`text-xs ${pos?'text-lk-accent':'text-lk-red'}`}>{pos?'↗':'↘'} {fmtPct(p.price_change_pct_24h||0)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
