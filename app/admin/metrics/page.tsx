'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks';

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n: number) {
  return n.toLocaleString('en-US');
}
function fmtMin(m: number) {
  if (m < 60) return `${m.toFixed(0)}m`;
  return `${(m / 60).toFixed(1)}h`;
}
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function timeAgo(iso: string | null) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type Metrics = {
  revenue: { total: number; rake: number; tx_fees: number; early_exit: number };
  pool: { total_deposited: number; distribution_pool: number; total_withdrawn: number };
  trading: { total_trades: number; total_volume: number; trades_today: number; volume_today: number; fees_today: number; trades_this_week: number };
  engagement: { total_users: number; total_sessions: number; sessions_today: number; dau: number; avg_session_min: number };
  users: Array<{
    id: string; email: string; display_name: string | null; joined: string;
    portfolio_value: number; initial_balance: number; pnl: number;
    total_trades: number; trades_today: number; trades_per_day: number;
    total_volume: number; total_fees_paid: number;
    total_sessions: number; total_page_views: number; time_spent_min: number;
    last_active: string | null;
  }>;
  generated_at: string;
};

type SortKey = keyof Metrics['users'][0];

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-1 ${accent ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className={`text-2xl font-bold leading-tight ${accent ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-white/30">{sub}</div>}
    </div>
  );
}

export default function AdminMetricsPage() {
  const { user, session } = useAuth();
  const [data, setData]   = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total_trades');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/metrics', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to load metrics');
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-emerald-400 text-sm uppercase tracking-widest mb-3">Admin access required</p>
          <p className="text-white/60">Sign in with your admin account.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center">
        <div className="text-white/40 text-sm">Loading metrics…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-red-400 mb-2">Error: {error}</p>
          <button onClick={load} className="text-xs text-white/40 underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sorted = [...data.users]
    .filter(u => !search || u.email.toLowerCase().includes(search.toLowerCase()) || (u.display_name ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });

  const SortTh = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      onClick={() => handleSort(k)}
      className="px-3 py-3 text-left text-[10px] uppercase tracking-wider text-white/40 cursor-pointer hover:text-white/70 whitespace-nowrap select-none"
    >
      {label}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="min-h-screen bg-[#020617] text-white px-6 py-10">
      <div className="max-w-[1400px] mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <a href="/admin/waitlist" className="text-xs text-white/40 hover:text-white/70 transition">← Waitlist</a>
              <span className="text-white/20">|</span>
              <span className="text-xs text-emerald-400 uppercase tracking-widest">Admin</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Beta Metrics</h1>
            <p className="text-white/40 text-sm mt-1">Last updated {timeAgo(data.generated_at)}</p>
          </div>
          <button onClick={load} className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm text-white/70 hover:bg-white/10 transition">
            Refresh
          </button>
        </div>

        {/* Revenue */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-white/30 mb-3 pb-2 border-b border-white/10">Revenue</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Revenue" value={fmt(data.revenue.total)} accent />
            <StatCard label="Platform Rake (5%)" value={fmt(data.revenue.rake)} sub="from deposits" />
            <StatCard label="Transaction Fees" value={fmt(data.revenue.tx_fees)} sub="0.2–5% per trade" />
            <StatCard label="Early Exit Fees (3%)" value={fmt(data.revenue.early_exit)} sub="stays in pool" />
          </div>
        </section>

        {/* Pool */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-white/30 mb-3 pb-2 border-b border-white/10">Prize Pool</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Deposited" value={fmt(data.pool.total_deposited)} sub="gross deposits" />
            <StatCard label="Distribution Pool" value={fmt(data.pool.distribution_pool)} sub="pays out at settlement" accent />
            <StatCard label="Early Exits" value={fmt(data.pool.total_withdrawn)} sub="mid-season withdrawals" />
          </div>
        </section>

        {/* Trading */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-white/30 mb-3 pb-2 border-b border-white/10">Trading Activity</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <StatCard label="Total Trades" value={fmtNum(data.trading.total_trades)} />
            <StatCard label="Total Volume" value={fmt(data.trading.total_volume)} />
            <StatCard label="Trades Today" value={fmtNum(data.trading.trades_today)} />
            <StatCard label="Volume Today" value={fmt(data.trading.volume_today)} />
            <StatCard label="Fees Today" value={fmt(data.trading.fees_today)} />
            <StatCard label="Trades This Week" value={fmtNum(data.trading.trades_this_week)} />
          </div>
        </section>

        {/* Engagement */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-white/30 mb-3 pb-2 border-b border-white/10">Engagement</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Beta Users" value={fmtNum(data.engagement.total_users)} accent />
            <StatCard label="DAU (Today)" value={fmtNum(data.engagement.dau)} />
            <StatCard label="Sessions Today" value={fmtNum(data.engagement.sessions_today)} />
            <StatCard label="Total Sessions" value={fmtNum(data.engagement.total_sessions)} />
            <StatCard label="Avg Session" value={fmtMin(data.engagement.avg_session_min)} sub="per session" />
          </div>
        </section>

        {/* Per-user table */}
        <section>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3 pb-2 border-b border-white/10">
            <h2 className="text-[10px] uppercase tracking-widest text-white/30">
              Users ({sorted.length}{search ? ` of ${data.users.length}` : ''})
            </h2>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by email…"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-emerald-500/50 w-56"
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="border-b border-white/10 bg-white/5">
                <tr>
                  <SortTh k="email"          label="User" />
                  <SortTh k="joined"         label="Joined" />
                  <SortTh k="portfolio_value" label="Portfolio" />
                  <SortTh k="pnl"            label="P&L" />
                  <SortTh k="total_trades"   label="Trades" />
                  <SortTh k="trades_today"   label="Today" />
                  <SortTh k="trades_per_day" label="Trades/Day" />
                  <SortTh k="total_volume"   label="Volume" />
                  <SortTh k="total_fees_paid" label="Fees Paid" />
                  <SortTh k="total_sessions" label="Sessions" />
                  <SortTh k="total_page_views" label="Page Views" />
                  <SortTh k="time_spent_min" label="Time Spent" />
                  <SortTh k="last_active"    label="Last Active" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={13} className="px-4 py-8 text-center text-white/30 text-sm">No users yet.</td></tr>
                ) : sorted.map(u => (
                  <tr key={u.id} className="border-t border-white/[0.06] hover:bg-white/[0.03] transition-colors">
                    <td className="px-3 py-3">
                      <div className="font-medium text-white text-xs">{u.display_name ?? u.email.split('@')[0]}</div>
                      <div className="text-white/40 text-[11px]">{u.email}</div>
                    </td>
                    <td className="px-3 py-3 text-white/50 text-xs whitespace-nowrap">{fmtDate(u.joined)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-white">{fmt(u.portfolio_value)}</td>
                    <td className={`px-3 py-3 font-mono text-xs font-semibold ${u.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {u.pnl >= 0 ? '+' : ''}{fmt(u.pnl)}
                    </td>
                    <td className="px-3 py-3 text-center text-white/80 text-xs">{u.total_trades}</td>
                    <td className={`px-3 py-3 text-center text-xs font-semibold ${u.trades_today > 0 ? 'text-emerald-400' : 'text-white/30'}`}>
                      {u.trades_today > 0 ? u.trades_today : '—'}
                    </td>
                    <td className="px-3 py-3 text-center text-white/60 text-xs">{u.trades_per_day}</td>
                    <td className="px-3 py-3 font-mono text-xs text-white/70">{fmt(u.total_volume)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-white/50">{fmt(u.total_fees_paid)}</td>
                    <td className="px-3 py-3 text-center text-white/60 text-xs">{u.total_sessions || '—'}</td>
                    <td className="px-3 py-3 text-center text-white/60 text-xs">{u.total_page_views || '—'}</td>
                    <td className={`px-3 py-3 text-center text-xs font-medium ${u.time_spent_min > 0 ? 'text-white/80' : 'text-white/30'}`}>
                      {u.time_spent_min > 0 ? fmtMin(u.time_spent_min) : '—'}
                    </td>
                    <td className="px-3 py-3 text-white/40 text-xs whitespace-nowrap">{timeAgo(u.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11px] text-white/20 text-center pb-4">
          {data.engagement.total_users} approved beta users · Generated {new Date(data.generated_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
