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
    body: 'Browse the market for NBA players. Each player has a futures contract priced by a live AMM and stat-driven expected value.',
  },
  {
    step: '2',
    title: 'Buy or Sell',
    body: 'Buy (go long) if you think the player\'s price will rise. Sell (go short) if you think it will fall. Enter a dollar amount — 50% is held as initial margin.',
  },
  {
    step: '3',
    title: 'Daily Mark-to-Market',
    body: 'At the end of each UTC day, your contracts are marked to the settlement price. Gains are credited to your cash; losses are debited. This is standard futures variation margin.',
  },
  {
    step: '4',
    title: 'Season Settlement',
    body: `On ${settlementDate}, all open contracts are force-closed at the final mark price. Your cash balance reflects your total P&L for the season.`,
  },
];

const GLOSSARY = [
  { term: 'Contract', def: 'One unit of a player futures position. Dollar-denominated — 1 contract = $1 of notional per price point.' },
  { term: 'Mark-to-Market (MTM)', def: 'Daily process where each contract\'s P&L for the day is settled in cash. Your balance goes up or down before you even close the trade.' },
  { term: 'Variation Margin', def: 'The daily cash flow from MTM. A $+20 day credits $20 to your cash; a −$15 day debits $15.' },
  { term: 'Initial Margin (IM)', def: '50% of position notional locked when you open a contract. Released when you close.' },
  { term: 'Maintenance Margin (MM)', def: '25% of notional. If your equity falls to this level, all positions are liquidated.' },
  { term: 'Notional', def: '|contracts| × mark price. The full dollar exposure of your position.' },
  { term: 'AMM', def: 'Automated Market Maker. Prices move with every trade using a constant-product pool (x × y = k).' },
  { term: 'Settlement Price', def: 'The official daily close price used to compute variation margin.' },
  { term: 'Long / Buy', def: 'You profit when the contract price rises.' },
  { term: 'Short / Sell', def: 'You profit when the contract price falls.' },
  { term: 'Liquidation', def: 'When your equity falls to maintenance margin, all contracts are closed at the current mark price.' },
];

export default function AboutView() {
  return (
    <div className="p-4 animate-fade-in space-y-4 pb-8">

      {/* Brand */}
      <div className="flex items-center gap-3 pt-2 pb-1">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center text-lk-bg font-extrabold text-xl flex-shrink-0">L</div>
        <div>
          <div className="font-bold text-lg leading-tight">Laksh</div>
          <div className="text-xs text-lk-dim">The 24/7 Sports Futures Exchange</div>
        </div>
      </div>

      <p className="text-sm text-lk-text leading-relaxed">
        Laksh is a simulated NBA player futures exchange. Trade long or short on athlete performance, manage margin, and compete on the leaderboard — all with virtual money.
      </p>

      {/* Key numbers */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Starting Cash', value: '$10,000' },
          { label: 'Initial Margin', value: '50%' },
          { label: 'Maint. Margin', value: '25%' },
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

      {/* Futures 101 */}
      <Card>
        <Label>Futures 101</Label>
        <p className="text-xs text-lk-dim leading-relaxed mt-1 mb-3">
          In a futures market, you don't need to buy an asset outright. Instead, you post margin and hold a <em className="text-lk-text">contract</em> — an agreement to settle at the future price. Each day, the contract is marked to the current market price and the difference is settled in cash. This is called <strong className="text-lk-accent">daily mark-to-market</strong>.
        </p>
        <div className="rounded-xl bg-lk-accent/5 border border-lk-accent/10 p-3 text-xs space-y-1 text-lk-dim">
          <div className="font-semibold text-lk-text mb-1">Example</div>
          <div>You buy 10 LeBron contracts at <span className="text-lk-text">$50</span> (notional = $500). Margin held = $250.</div>
          <div>Day 1 close: price = <span className="text-lk-accent">$55</span>. Variation margin = +$50 credited to your cash.</div>
          <div>Day 2 close: price = <span className="text-lk-red">$48</span>. Variation margin = −$70 debited from your cash.</div>
          <div>If you close on Day 2: realize total P&L = (48−50)×10 = <span className="text-lk-red">−$20</span>. Cash net of all flows matches.</div>
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
