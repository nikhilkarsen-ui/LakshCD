'use client';
import { Card, Label } from './ui';
import { SEASON } from '@/config/constants';

const settlementDate = new Date(SEASON.settlement_date).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric',
});

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Pick a Player',
    body: 'Browse the market for NBA players. Each player has a share price driven by AMM trading and a stat-based expected final value.',
  },
  {
    step: '2',
    title: 'Buy Shares',
    body: 'Spend virtual cash to buy shares. Your cash is deducted immediately and you receive shares at the current market price.',
  },
  {
    step: '3',
    title: 'Track Your Holdings',
    body: 'Monitor each holding\'s market value, unrealized P&L (vs. your avg cost), and any realized gains from past sells.',
  },
  {
    step: '4',
    title: 'Season Settlement',
    body: `On ${settlementDate}, all remaining share holdings are automatically settled at each player's final season price. Cash is credited to your balance.`,
  },
];

const GLOSSARY = [
  { term: 'Shares', def: 'Units of ownership in a player. Buy shares to gain exposure to their price movement.' },
  { term: 'Average Cost', def: 'Weighted average price you paid per share across all your buys. Used to compute unrealized P&L.' },
  { term: 'Market Value', def: 'Your shares × current market price. How much your holding is worth right now.' },
  { term: 'Unrealized P&L', def: 'Market value minus your cost basis. Profit (or loss) if you were to sell at today\'s price.' },
  { term: 'Realized P&L', def: 'Actual profit or loss locked in from past sells. Sell price minus average cost, times shares sold.' },
  { term: 'Expected Final Value', def: 'The model\'s estimate of the player\'s share price at season end, based on current season stats.' },
  { term: 'AMM', def: 'Automated Market Maker. Prices move with every trade using a constant-product pool (x × y = k). Buys push price up, sells push it down.' },
  { term: 'Final Settlement Price', def: 'The price at which all remaining shares are settled when the season ends.' },
  { term: 'Season Settlement', def: `On ${settlementDate}, all holdings are auto-converted to cash at the final settlement price.` },
];

export default function AboutView() {
  return (
    <div className="p-4 animate-fade-in space-y-4 pb-8">

      {/* Brand */}
      <div className="flex items-center gap-3 pt-2 pb-1">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center text-lk-bg font-extrabold text-xl flex-shrink-0">L</div>
        <div>
          <div className="font-bold text-lg leading-tight">Laksh</div>
          <div className="text-xs text-lk-dim">The 24/7 Player Share Market</div>
        </div>
      </div>

      <p className="text-sm text-lk-text leading-relaxed">
        Laksh is a simulated NBA player share market. Buy and sell player shares, track your holdings, and compete on the leaderboard — all with virtual money. Prices reflect the market's best estimate of each player's final season value.
      </p>

      {/* Key numbers */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Starting Cash', value: '$10,000' },
          { label: 'No Margin', value: '0%' },
          { label: 'No Shorting', value: 'N/A' },
          { label: 'Trade Fee', value: '0.1%' },
          { label: 'Price Updates', value: 'Every 5s' },
          { label: 'Settlement', value: 'Jun 15, 2026' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-lk-border bg-lk-card p-3 text-center">
            <div className="text-[10px] text-lk-dim mb-1">{k.label}</div>
            <div className="text-sm font-bold text-lk-accent">{k.value}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <Card>
        <Label>How It Works</Label>
        <div className="space-y-4 mt-1">
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

      {/* Prediction Market 101 */}
      <Card>
        <Label>How Pricing Works</Label>
        <p className="text-xs text-lk-dim leading-relaxed mt-1 mb-3">
          Each player's share price is the market's current estimate of their <strong className="text-lk-accent">final settlement value</strong> at season end. As the season progresses, prices drift toward the model's expected final value based on stats. Trading activity also moves price immediately — buys push it up, sells push it down.
        </p>
        <div className="rounded-xl bg-lk-accent/5 border border-lk-accent/10 p-3 text-xs space-y-1 text-lk-dim">
          <div className="font-semibold text-lk-text mb-1">Example</div>
          <div>You buy 2 LeBron shares at <span className="text-lk-text">$280</span>. Cost basis = $560.</div>
          <div>Price rises to <span className="text-lk-accent">$310</span>. Unrealized P&L = +$60.</div>
          <div>You sell 1 share at $310. Realized P&L = +$30. You still own 1 share.</div>
          <div>At season end, your last share settles at the final price, automatically converting to cash.</div>
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
        Laksh is a simulated trading platform for educational and entertainment purposes only. All positions use virtual money. Nothing on this platform constitutes financial advice.
      </div>
    </div>
  );
}
