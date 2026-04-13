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
    title: 'You join the pool',
    body: 'Your $10,000 enters a shared prize pool. The platform takes 5% upfront as rake — the remaining 95% is the prize pot that gets paid out at season end.',
  },
  {
    step: '2',
    title: 'Trade player shares',
    body: 'Buy shares in players you believe in. Sell any shares you own at any time. Prices update every 5 seconds based on trading and live game stats.',
  },
  {
    step: '3',
    title: 'Build a stronger portfolio',
    body: 'Your portfolio value = your cash balance + the market value of every share you hold. The more your portfolio grows relative to others, the bigger your slice of the payout.',
  },
  {
    step: '4',
    title: 'Pool pays out on ' + settlementDate,
    body: `The prize pool is distributed proportionally: your payout = (your portfolio value ÷ total of all portfolios) × prize pool. Outperform the field, walk away with more than you put in.`,
  },
];

const GLOSSARY = [
  {
    term: 'Prize pool',
    def: 'The total pot that gets paid out at season end. Made up of all participant deposits minus the 5% platform rake. Every dollar in the pool comes from a real participant — no money is created from thin air.',
  },
  {
    term: 'Share price',
    def: 'The current market price of one share in a player. Moves up when people buy, down when people sell, and drifts toward fair value between trades.',
  },
  {
    term: 'Portfolio value',
    def: 'Your total mark-to-market value: cash balance + (shares held × current price for each player). This is what determines your proportional share of the payout.',
  },
  {
    term: 'Proportional payout',
    def: 'Your settlement payout = (your portfolio value ÷ sum of all portfolios) × prize pool. If your portfolio is 2% of all portfolios combined, you receive 2% of the prize pool.',
  },
  {
    term: 'Expected final value',
    def: 'The model\'s estimate of a player\'s share price at season end, calculated from current season stats. Prices drift toward this between trades.',
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
    def: 'Profit or loss locked in by selling. Calculated as (sell price − avg cost) × shares sold.',
  },
  {
    term: 'Early exit',
    def: `Withdraw before ${settlementDate} at your current portfolio value, minus a 3% early exit fee. The fee stays in the pool — it increases the payout for everyone who stays.`,
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
        Laksh is a parimutuel NBA player market. Everyone joins with $10,000. Those funds go into a shared prize pool. Trade player shares to build the strongest portfolio — and at season end, the pool is split proportionally based on how everyone performed.
      </p>

      {/* Settlement + P&L row */}
      <div className="grid grid-cols-2 gap-2">
        {/* Payout countdown */}
        <div className="rounded-2xl border border-lk-accent/20 bg-lk-accent/5 p-4 flex flex-col justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Pool payout date</div>
            <div className="font-semibold text-sm">{settlementDate}</div>
            <div className="text-[11px] text-lk-dim mt-0.5">Pool distributed proportionally</div>
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
          { label: 'Pool rake', value: '5%' },
          { label: 'Early exit fee', value: '3%' },
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
          <div>At season end, your portfolio value determines your share of the prize pool — the higher relative to everyone else, the more you receive.</div>
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
        Laksh is a simulated trading platform for educational and entertainment purposes only. All cash and pool balances are virtual. Nothing here constitutes financial advice.
      </div>
    </div>
  );
}
