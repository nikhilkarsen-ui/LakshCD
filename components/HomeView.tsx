'use client';
import { useState, useMemo, memo } from 'react';
import { Player } from '@/types';
import { Sparkline } from './Sparkline';
import { Card, Avatar, Label, Skel, fmtCompact, fmtPct } from './ui';

// ─── Fallback sparkline generator ─────────────────────────────────────────────
// Used only when real price_history isn't available yet.
// Deterministic LCG seeded from price so it doesn't jitter on re-render.
function lcg(seed: number) {
  let s = (seed * 1664525 + 1013904223) & 0xffffffff;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function buildFallback(
  currentPrice: number,
  changePct24h: number,
  volatility: number,
  pts = 28,
): { price: number }[] {
  const startPrice = currentPrice / (1 + (changePct24h || 0) / 100);
  const vol  = Math.max(0.008, volatility || 0.02) * 0.55;
  const rand = lcg(Math.round(currentPrice * 100) + Math.round(startPrice * 7));
  const raw: number[] = [];
  let p = startPrice;
  for (let j = 0; j < pts; j++) {
    const t = j / (pts - 1);
    p = Math.max(1, p + 0.30 * (startPrice + (currentPrice - startPrice) * t - p) + (rand() - 0.5) * p * vol * (1 - t * 0.4));
    raw.push(Math.round(p * 100) / 100);
  }
  raw[raw.length - 1] = currentPrice;
  // 3-point smooth pass
  return raw.map((v, i) =>
    i === 0 || i === raw.length - 1
      ? { price: v }
      : { price: Math.round(((raw[i - 1] + v + raw[i + 1]) / 3) * 100) / 100 },
  );
}

// ─── Player row ───────────────────────────────────────────────────────────────
const PlayerRow = memo(function PlayerRow({
  player,
  index,
  sparkData,
  onClick,
}: {
  player: Player;
  index: number;
  sparkData: { price: number }[];
  onClick: () => void;
}) {
  const pos   = (player.price_change_pct_24h || 0) >= 0;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3.5 border-b border-lk-border last:border-b-0 cursor-pointer hover:bg-lk-hover transition-colors"
    >
      <Avatar name={player.name} i={index} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate">{player.name}</span>
          {player.injury_status && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20 flex-shrink-0">
              {player.injury_status === 'Out For Season' || player.injury_status === 'Suspended' ? 'OUT'
                : player.injury_status === 'Out'          ? 'OUT'
                : player.injury_status === 'Doubtful'     ? 'DTD'
                : player.injury_status === 'Questionable' ? 'Q'
                : player.injury_status === 'Day-To-Day'   ? 'DTD'
                : 'P'}
            </span>
          )}
        </div>
        <div className="text-xs text-lk-dim">{player.team}</div>
      </div>

      {/* Sparkline */}
      <div className="flex-shrink-0">
        <Sparkline data={sparkData} isPositive={pos} width={80} height={34} />
      </div>

      <div className="text-right min-w-[72px]">
        <div className="font-semibold text-sm tabular-nums">${player.current_price.toFixed(2)}</div>
        <div className={`text-xs ${pos ? 'text-lk-accent' : 'text-lk-red'}`}>
          {pos ? '↗' : '↘'} {fmtPct(player.price_change_pct_24h || 0)}
        </div>
      </div>
    </div>
  );
});

// ─── HomeView ─────────────────────────────────────────────────────────────────
const TEAM_ABBREVS: Record<string, string> = {
  'Atlanta Hawks':           'ATL',
  'Boston Celtics':          'BOS',
  'Charlotte Hornets':       'CHA',
  'Cleveland Cavaliers':     'CLE',
  'Denver Nuggets':          'DEN',
  'Detroit Pistons':         'DET',
  'Golden State Warriors':   'GSW',
  'Houston Rockets':         'HOU',
  'Los Angeles Lakers':      'LAL',
  'Minnesota Timberwolves':  'MIN',
  'New York Knicks':         'NYK',
  'Oklahoma City Thunder':   'OKC',
  'Philadelphia 76ers':      'PHI',
  'Portland Trail Blazers':  'POR',
  'San Antonio Spurs':       'SAS',
  'Toronto Raptors':         'TOR',
};

export default function HomeView({
  players,
  marketCap,
  loading,
  sparklines = {},
  onSelect,
}: {
  players: Player[];
  marketCap: number;
  loading: boolean;
  sparklines?: Record<string, { price: number }[]>;
  onSelect: (p: Player) => void;
}) {
  const [q, setQ]           = useState('');
  const [teamFilter, setTeamFilter] = useState<string | null>(null);

  // Derive sorted unique teams from the loaded player list
  const teams = useMemo(() => {
    const seen = new Set<string>();
    for (const p of players) seen.add(p.team);
    return Array.from(seen).sort();
  }, [players]);

  const filtered = useMemo(() => {
    let list = players;
    if (teamFilter) list = list.filter(p => p.team === teamFilter);
    if (q) list = list.filter(p =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.team.toLowerCase().includes(q.toLowerCase()),
    );
    return list;
  }, [players, q, teamFilter]);

  // Build sparkline data per player — real data if available, fallback otherwise.
  // Memoized on price (changes when tick fires) so rows only re-render on actual price moves.
  const sparkData = useMemo(() => {
    const out: Record<string, { price: number }[]> = {};
    for (const p of players) {
      const real = sparklines[p.id];
      out[p.id] = real && real.length >= 4
        ? real
        : buildFallback(p.current_price, p.price_change_pct_24h || 0, p.volatility || 0.02);
    }
    return out;
  }, [players, sparklines]);

  if (loading) return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => <Skel key={i} className="h-16 w-full" />)}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="mx-4 mt-4 mb-2">
        <div className="flex items-center gap-2 bg-lk-card border border-lk-border rounded-xl px-4 py-2.5">
          <svg width="16" height="16" fill="none" stroke="#64748b" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search athletes, teams..."
            value={q}
            onChange={e => setQ(e.target.value)}
            className="flex-1 bg-transparent border-none text-lk-text text-sm outline-none placeholder:text-lk-muted"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-lk-muted hover:text-lk-text transition-colors">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Team filter chips */}
      {teams.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setTeamFilter(null)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              !teamFilter
                ? 'bg-lk-accent text-black border-lk-accent'
                : 'bg-lk-card border-lk-border text-lk-dim hover:text-lk-text'
            }`}
          >
            All
          </button>
          {teams.map(team => {
            const abbrev = TEAM_ABBREVS[team] ?? team.split(' ').pop()?.slice(0, 3).toUpperCase() ?? team;
            const active = teamFilter === team;
            return (
              <button
                key={team}
                onClick={() => setTeamFilter(active ? null : team)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-lk-accent text-black border-lk-accent'
                    : 'bg-lk-card border-lk-border text-lk-dim hover:text-lk-text'
                }`}
              >
                {abbrev}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-4 mb-3 mt-1">
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

      <div className="px-4 mb-2 flex justify-between">
        <Label>Trending Now</Label>
        <span className="text-xs text-lk-accent">{filtered.length} players</span>
      </div>

      <div className="mx-4 bg-lk-card border border-lk-border rounded-xl overflow-hidden mb-6">
        {filtered.map((p, i) => (
          <PlayerRow
            key={p.id}
            player={p}
            index={i}
            sparkData={sparkData[p.id] ?? []}
            onClick={() => onSelect(p)}
          />
        ))}
      </div>
    </div>
  );
}
