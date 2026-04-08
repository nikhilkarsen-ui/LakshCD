'use client';
import { Card, Label, Skel, fmt, fmtPct } from './ui';
import { useLeaderboard, useAuth } from '@/hooks';

export default function LeaderboardView() {
  const { leaderboard, totalTraders, loading } = useLeaderboard();
  const { user } = useAuth();
  if (loading) return <div className="p-4 space-y-3">{Array.from({length:8}).map((_,i)=><Skel key={i} className="h-14 w-full"/>)}</div>;
  return (
    <div className="p-4 animate-fade-in space-y-3">
      <Card className="text-center bg-gradient-to-br from-lk-accent/5 to-lk-accent/[0.02]">
        <div className="text-xl font-bold">{totalTraders} Traders</div>
        <div className="text-xs text-lk-dim mt-1">Ranked by portfolio returns</div>
      </Card>
      {leaderboard.length === 0 ? <Card><div className="text-center py-8 text-lk-dim">No traders yet</div></Card> : (
        <Card className="p-0 overflow-hidden">
          {leaderboard.map((e, i) => {
            const me = user && e.user_id === user.id;
            return (
              <div key={e.user_id} className={`flex items-center gap-3 px-4 py-3.5 border-b border-lk-border last:border-b-0 ${me?'bg-lk-accent/[0.06]':''}`}>
                <div className="w-7 text-center font-bold text-sm">{i===0?'🥇':i===1?'🥈':i===2?'🥉':<span className="text-lk-dim">#{i+1}</span>}</div>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${me?'bg-lk-accent-dim text-lk-accent':'bg-lk-border text-lk-dim'}`}>{e.display_name.slice(0,2).toUpperCase()}</div>
                <div className="flex-1 min-w-0"><div className={`text-sm font-medium truncate ${me?'text-lk-accent font-bold':''}`}>{me?`${e.display_name} (You)`:e.display_name}</div><div className="text-[11px] text-lk-dim">{e.num_trades} trades · {fmt(e.portfolio_value)}</div></div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${e.return_pct>=0?'text-lk-accent bg-lk-accent-dim':'text-lk-red bg-lk-red-dim'}`}>{fmtPct(e.return_pct)}</span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
