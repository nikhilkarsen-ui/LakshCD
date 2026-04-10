'use client';
import { Card, Label, Skel, fmt, fmtPct } from './ui';
import { usePortfolio, useCountdown } from '@/hooks';
import { SEASON } from '@/config/constants';

export default function ProfileView({ onSignOut }: { onSignOut: () => void }) {
  const { portfolio, userProfile, trades, loading } = usePortfolio();
  const countdown = useCountdown(SEASON.settlement_date);

  if (loading || !userProfile || !portfolio) return <div className="p-4 space-y-3"><Skel className="h-32 w-full"/><Skel className="h-28 w-full"/><Skel className="h-64 w-full"/></div>;

  const pos = portfolio.total_pnl >= 0;

  return (
    <div className="p-4 animate-fade-in space-y-3">
      <Card className="text-center pt-6 pb-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center mx-auto mb-3 text-2xl font-bold text-lk-bg">
          {(userProfile.display_name || 'T')[0].toUpperCase()}
        </div>
        <div className="font-bold text-lg">{userProfile.display_name}</div>
        <div className="text-xs text-lk-dim mt-1">{userProfile.email}</div>
        <button onClick={onSignOut} className="mt-4 px-5 py-2 rounded-lg bg-lk-red/10 text-lk-red text-xs font-medium hover:bg-lk-red/20 transition-colors">Sign Out</button>
      </Card>

      <Card>
        <Label>Account</Label>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-[11px] text-lk-dim">Cash Balance</div><div className="text-xl font-bold mt-1">{fmt(portfolio.cash_balance)}</div></div>
          <div><div className="text-[11px] text-lk-dim">Portfolio Value</div><div className="text-xl font-bold mt-1">{fmt(portfolio.total_value)}</div></div>
          <div><div className="text-[11px] text-lk-dim">Total P&L</div><div className={`text-xl font-bold mt-1 ${pos?'text-lk-accent':'text-lk-red'}`}>{pos?'+':''}{fmt(portfolio.total_pnl)}</div></div>
          <div><div className="text-[11px] text-lk-dim">Return</div><div className={`text-xl font-bold mt-1 ${pos?'text-lk-accent':'text-lk-red'}`}>{fmtPct(portfolio.total_pnl_pct)}</div></div>
        </div>
      </Card>

      <Card>
        <Label>Trade History</Label>
        {(!trades || trades.length === 0) ? <div className="text-center py-8 text-lk-dim text-sm">No trades yet</div> : (
          <div>
            {trades.slice(0, 30).map((t: any, i: number) => {
              const isBuy = t.side === 'buy';
              const isSettlement = t.side === 'settlement';
              return (
                <div key={t.id} className={`flex items-center gap-3 py-2.5 ${i<Math.min(trades.length,30)-1?'border-b border-lk-border':''}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isBuy?'bg-lk-accent-dim':isSettlement?'bg-lk-accent-dim/50':'bg-lk-red-dim'}`}>
                    <svg width="14" height="14" fill="none" stroke={isBuy?'#00d4aa':isSettlement?'#00d4aa':'#ff4757'} strokeWidth="2" viewBox="0 0 24 24">
                      {isBuy ? <path d="M12 19V5M5 12l7-7 7 7"/> : <path d="M12 5v14M19 12l-7 7-7-7"/>}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate capitalize">{t.side} {t.player?.name || 'Unknown'}</div>
                    <div className="text-[11px] text-lk-dim">{Number(t.shares).toFixed(4)} shares @ ${Number(t.price).toFixed(2)}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-xs font-medium ${(t.realized_pnl||0)>=0?'text-lk-accent':'text-lk-red'}`}>
                      {t.realized_pnl !== 0 ? ((t.realized_pnl>=0?'+':'')+fmt(t.realized_pnl)) : fmt(Number(t.total_value||0))}
                    </div>
                    <div className="text-[10px] text-lk-muted">{new Date(t.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="bg-lk-red/[0.03] border-lk-red/10">
        <Label>Settlement</Label>
        <div className="text-sm leading-relaxed">All remaining share holdings settle automatically on <span className="text-lk-accent font-semibold">June 15, 2026</span> at each player's final season value.</div>
        <div className="text-xl font-bold text-lk-accent mt-3 font-mono">{countdown}</div>
      </Card>
    </div>
  );
}
