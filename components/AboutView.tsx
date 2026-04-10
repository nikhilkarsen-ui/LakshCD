'use client';
import { Card, Label } from './ui';
import LakshLogo from './LakshLogo';
import { SEASON } from '@/config/constants';
import { useCountdown, usePortfolio } from '@/hooks';
import { fmt, fmtPct } from './ui';

const settlementDate = new Date(SEASON.settlement_date).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Browse players',
    body: 'Every NBA player has a live share price — the market\'s current estimate of how much they\'ll be worth at season end.',
  },
  {
    step: '2',
    title: 'Buy shares',
    body: 'Spend your virtual cash to buy shares. You receive shares at the current price. Cash is deducted immediately.',
  },
  {
    step: '3',
    title: 'Sell when you want',
    body: 'Sell any shares you own back to the market at any time. You can only sell what you own.',
  },
  {
    step: '4',
    title: 'Settle at season end',
    body: `On ${settlementDate}, all remaining shares are automatically converted to cash at each player's final settlement price. No action required.`,
  },
];

const GLOSSARY = [
  {
    term: 'Share price',
    def: 'The current market price of one share in a player. Moves up when people buy, down when people sell.',
  },
  {
    term: 'Expected final value',
    def: 'The model\'s estimate of what the share price should be at season end, based on current season stats. Prices drift toward this over time.',
  },
  {
    term: 'Average cost',
    def: 'The weighted average price you paid per share across all your buys in a player.',
  },
  {
    term: 'Unrealized P&L',
    def: 'The gain or loss on shares you still hold. Calculated as (current price − avg cost) × shares owned.',
  },
  {
    term: 'Realized P&L',
    def: 'Profit or loss you\'ve already locked in by selling. Calculated as (sell price − avg cost) × shares sold.',
  },
  {
    term: 'Final settlement price',
    def: 'The price used to settle all remaining shares at season end. Set based on the player\'s final season performance.',
  },
  {
    term: 'Season settlement',
    def: `On ${settlementDate}, every share you hold is automatically sold at the final settlement price and cash is added to your balance.`,
  },
];

export default function AboutView() {
  const countdown = useCountdown(SEASON.settlement_date);
  const { portfolio } = usePortfolio();
  const totalPnl = portfolio?.total_pnl ?? null;
  const totalPnlPct = portfolio?.total_pnl_pct ?? null;
  const up = (totalPnl ?? 0) >= 0;

  return (
    <div className="p-4 animate-fade-in space-y-3 pb-8">

      {/* Brand header */}
      <div className="flex items-center gap-3 pt-2 pb-1">
        <LakshLogo className="w-11 h-11 flex-shrink-0" />
        <div>
          <div className="font-bold text-lg leading-tight">Laksh</div>
          <div className="text-xs text-lk-dim">Buy and sell player shares. Settle at season end.</div>
        </div>
      </div>

      {/* One-liner */}
      <p className="text-sm text-lk-text leading-relaxed">
        Laksh is a simulated NBA player share market. Each player has a live share price — the market's collective estimate of their final season value. Buy shares in players you believe in, sell when you want, and hold through to settlement on {settlementDate}.
      </p>

      {/* Settlement + P&L row */}
      <div className="grid grid-cols-2 gap-2">
        {/* Settlement countdown */}
        <div className="rounded-2xl border border-lk-accent/20 bg-lk-accent/5 p-4 flex flex-col justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Season settlement</div>
            <div className="font-semibold text-sm">{settlementDate}</div>
            <div className="text-[11px] text-lk-dim mt-0.5">Shares auto-convert to cash</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Countdown</div>
            <div className="font-mono text-sm font-bold text-lk-accent">{countdown}</div>
          </div>
        </div>

        {/* Live total P&L */}
        <div className={`rounded-2xl border p-4 flex flex-col justify-between gap-2 ${up ? 'border-lk-accent/20 bg-lk-accent/5' : 'border-lk-red/20 bg-lk-red/5'}`}>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Your Total P&amp;L</div>
            {totalPnl === null ? (
              <div className="text-sm text-lk-dim">—</div>
            ) : (
              <div className={`font-bold text-xl leading-tight ${up ? 'text-lk-accent' : 'text-lk-red'}`}>
                {up ? '+' : ''}{fmt(totalPnl)}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Return</div>
            {totalPnlPct === null ? (
              <div className="text-sm text-lk-dim">—</div>
            ) : (
              <div className={`font-mono text-sm font-bold ${up ? 'text-lk-accent' : 'text-lk-red'}`}>
                {fmtPct(totalPnlPct)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Key facts */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Starting cash', value: '$10,000' },
          { label: 'Trade fee', value: '0.1%' },
          { label: 'Price updates', value: 'Every 5s' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-lk-border bg-lk-card p-3 text-center">
            <div className="text-[10px] text-lk-dim mb-1">{k.label}</div>
            <div className="text-sm font-bold text-lk-accent leading-tight">{k.value}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <Card>
        <Label>How It Works</Label>
        <div className="space-y-4 mt-2">
          {HOW_IT_WORKS.map(s => (
            <div key={s.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-xl bg-lk-accent/10 border border-lk-accent/20 flex items-center justify-center text-lk-accent font-bold text-xs flex-shrink-0 mt-0.5">
                {s.step}
              </div>
              <div>
                <div className="font-semibold text-sm mb-0.5">{s.title}</div>
                <div className="text-xs text-lk-dim leading-relaxed">{s.body}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* How pricing works */}
      <Card>
        <Label>How Prices Work</Label>
        <p className="text-xs text-lk-dim leading-relaxed mt-1 mb-3">
          Each player's share price represents the market's current best estimate of their <span className="text-lk-text font-medium">final settlement value</span> at season end. Two things move the price:
        </p>
        <div className="space-y-2 mb-3">
          <div className="rounded-xl bg-lk-card border border-lk-border p-3 text-xs">
            <div className="font-medium text-lk-text mb-1">Trading activity</div>
            <div className="text-lk-dim leading-relaxed">Every buy pushes the price up. Every sell pushes it down. The more you trade, the bigger the move.</div>
          </div>
          <div className="rounded-xl bg-lk-card border border-lk-border p-3 text-xs">
            <div className="font-medium text-lk-text mb-1">Season drift</div>
            <div className="text-lk-dim leading-relaxed">Between trades, prices slowly drift toward each player's expected final value — calculated from live season stats. The closer to season end, the stronger the pull.</div>
          </div>
        </div>
        <div className="rounded-xl bg-lk-accent/5 border border-lk-accent/10 p-3 text-xs space-y-1.5 text-lk-dim">
          <div className="font-semibold text-lk-text mb-1">Example</div>
          <div>You buy 2 Giannis shares at <span className="text-lk-text">$320</span>. Your cost basis = $640.</div>
          <div>Price rises to <span className="text-lk-accent">$355</span>. Unrealized P&L = <span className="text-lk-accent">+$70</span>.</div>
          <div>You sell 1 share at $355. Realized P&L = <span className="text-lk-accent">+$35</span>. You still hold 1 share.</div>
          <div>At season end, your last share settles at the final price. Cash is credited automatically.</div>
        </div>
      </Card>

      {/* Glossary */}
      <Card>
        <Label>Glossary</Label>
        <div className="divide-y divide-lk-border/50 mt-1">
          {GLOSSARY.map(g => (
            <div key={g.term} className="py-2.5">
              <div className="text-xs font-semibold text-lk-accent mb-0.5">{g.term}</div>
              <div className="text-xs text-lk-dim leading-relaxed">{g.def}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Disclaimer */}
      <div className="rounded-xl border border-lk-border/60 bg-lk-card/40 p-3 text-[11px] text-lk-muted leading-relaxed">
        Laksh is a simulated trading platform for educational and entertainment purposes only. All cash is virtual. Nothing here constitutes financial advice.
      </div>
    </div>
  );
}
