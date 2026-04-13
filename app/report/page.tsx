'use client';
import { useEffect } from 'react';

function DownloadButton() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <button
      onClick={handlePrint}
      style={{
        position: 'fixed', bottom: 32, right: 32, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#0f172a', color: '#fff',
        border: '1px solid #334155',
        borderRadius: 999, padding: '10px 20px',
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12 16l-4-4h3V4h2v8h3l-4 4zM4 18h16v2H4z"/>
      </svg>
      Save as PDF
    </button>
  );
}

export default function ReportPage() {
  useEffect(() => {
    document.title = 'Laksh — Investor & Founder Technical Brief';
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'DM Sans', -apple-system, sans-serif;
          font-size: 10pt;
          line-height: 1.65;
          color: #0f172a;
          background: #fff;
        }

        .report-wrap {
          max-width: 820px;
          margin: 0 auto;
          padding: 60px 64px;
        }

        /* ─── Cover ─── */
        .cover {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding-bottom: 64px;
          break-after: page;
        }
        .cover-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 64px;
        }
        .cover-logo svg { flex-shrink: 0; }
        .cover-logo-text { font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; color: #0f172a; }
        .cover-logo-sub { font-size: 8pt; letter-spacing: 0.28em; text-transform: uppercase; color: #64748b; margin-top: 2px; }

        .cover-rule { height: 3px; background: linear-gradient(90deg, #10b981 0%, #06b6d4 100%); border-radius: 2px; margin-bottom: 56px; }

        .cover-tag {
          display: inline-block;
          font-size: 7.5pt;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #059669;
          border: 1px solid #d1fae5;
          background: #f0fdf4;
          padding: 4px 10px;
          border-radius: 4px;
          margin-bottom: 20px;
        }
        .cover-title {
          font-size: 36pt;
          font-weight: 800;
          line-height: 1.08;
          letter-spacing: -0.03em;
          color: #0f172a;
          margin-bottom: 20px;
        }
        .cover-title span { color: #059669; }
        .cover-subtitle {
          font-size: 13pt;
          color: #475569;
          font-weight: 400;
          max-width: 540px;
          line-height: 1.6;
          margin-bottom: 48px;
        }
        .cover-meta-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1px;
          background: #e2e8f0;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 48px;
        }
        .cover-meta-cell {
          background: #f8fafc;
          padding: 16px 18px;
        }
        .cover-meta-label { font-size: 7pt; letter-spacing: 0.18em; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; }
        .cover-meta-value { font-size: 11pt; font-weight: 700; color: #0f172a; }

        .cover-footer { font-size: 8pt; color: #94a3b8; }
        .cover-footer span { color: #475569; font-weight: 500; }

        /* ─── TOC ─── */
        .toc-page { break-after: page; margin-bottom: 64px; }
        .toc-section { margin-bottom: 6pt; }
        .toc-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 5px 0;
          border-bottom: 1px dotted #e2e8f0;
        }
        .toc-num { font-size: 8pt; font-weight: 700; color: #059669; min-width: 28px; }
        .toc-title { font-size: 9.5pt; font-weight: 500; color: #0f172a; flex: 1; }
        .toc-dots { flex: 1; border-bottom: 1px dotted #cbd5e1; margin: 0 8px 3px; }
        .toc-page-num { font-size: 8pt; color: #94a3b8; font-variant-numeric: tabular-nums; min-width: 16px; text-align: right; }

        /* ─── Section headers ─── */
        .section-label {
          font-size: 7pt;
          font-weight: 700;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          color: #059669;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #d1fae5;
        }
        h1 {
          font-size: 22pt;
          font-weight: 800;
          letter-spacing: -0.025em;
          color: #0f172a;
          line-height: 1.15;
          margin-bottom: 16px;
        }
        h2 {
          font-size: 16pt;
          font-weight: 700;
          letter-spacing: -0.018em;
          color: #0f172a;
          margin-top: 36px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 2px solid #f1f5f9;
        }
        h3 {
          font-size: 11pt;
          font-weight: 700;
          color: #0f172a;
          margin-top: 24px;
          margin-bottom: 8px;
        }
        h4 {
          font-size: 9.5pt;
          font-weight: 600;
          color: #334155;
          margin-top: 16px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        p { margin-bottom: 10px; color: #334155; }
        p:last-child { margin-bottom: 0; }

        /* ─── Body text styles ─── */
        strong { font-weight: 700; color: #0f172a; }
        em { font-style: italic; color: #475569; }
        code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 8.5pt;
          background: #f1f5f9;
          padding: 1px 5px;
          border-radius: 3px;
          color: #0f172a;
        }

        /* ─── Code blocks ─── */
        pre {
          font-family: 'JetBrains Mono', monospace;
          font-size: 8pt;
          line-height: 1.6;
          background: #0f172a;
          color: #e2e8f0;
          border-radius: 6px;
          padding: 16px 20px;
          margin: 14px 0;
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }

        /* ─── Callout boxes ─── */
        .callout {
          border-left: 3px solid #10b981;
          background: #f0fdf4;
          padding: 12px 16px;
          border-radius: 0 6px 6px 0;
          margin: 14px 0;
        }
        .callout-warn {
          border-left-color: #f59e0b;
          background: #fffbeb;
        }
        .callout-danger {
          border-left-color: #ef4444;
          background: #fef2f2;
        }
        .callout p { margin: 0; color: #0f172a; font-size: 9.5pt; }

        /* ─── Tables ─── */
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0;
          font-size: 9pt;
        }
        th {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 7px 10px;
          text-align: left;
          font-weight: 600;
          font-size: 8pt;
          letter-spacing: 0.04em;
          color: #475569;
          text-transform: uppercase;
        }
        td {
          border: 1px solid #e2e8f0;
          padding: 7px 10px;
          color: #334155;
          vertical-align: top;
        }
        tr:nth-child(even) td { background: #f8fafc; }

        /* ─── Lists ─── */
        ul, ol {
          padding-left: 20px;
          margin-bottom: 10px;
        }
        li { margin-bottom: 5px; color: #334155; }
        li strong { color: #0f172a; }

        /* ─── Stat cards row ─── */
        .stat-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin: 16px 0;
        }
        .stat-card {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 14px 16px;
          text-align: center;
          background: #f8fafc;
        }
        .stat-card-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.14em; color: #94a3b8; margin-bottom: 4px; }
        .stat-card-value { font-size: 16pt; font-weight: 800; color: #059669; letter-spacing: -0.02em; }

        /* ─── Section break ─── */
        .section { margin-top: 48px; }
        .page-break { break-before: page; }

        /* ─── Pitch boxes ─── */
        .pitch-box {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 20px 24px;
          margin: 14px 0;
          background: #f8fafc;
        }
        .pitch-box-label {
          font-size: 7pt;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #059669;
          margin-bottom: 10px;
        }

        /* ─── Risk card ─── */
        .risk-item {
          border-left: 3px solid #e2e8f0;
          padding: 10px 14px;
          margin-bottom: 10px;
        }
        .risk-item.high { border-left-color: #ef4444; }
        .risk-item.medium { border-left-color: #f59e0b; }
        .risk-item.low { border-left-color: #10b981; }
        .risk-label { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 4px; }
        .risk-title { font-size: 10pt; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
        .risk-body { font-size: 9pt; color: #475569; }

        /* ─── Print settings ─── */
        @page {
          size: letter;
          margin: 0.55in 0.65in;
        }

        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          button { display: none !important; }
          .cover { min-height: auto; padding-bottom: 0; }
          pre { white-space: pre-wrap; }
          h2, h3 { break-after: avoid; }
          table { break-inside: avoid; }
          .risk-item { break-inside: avoid; }
          .pitch-box { break-inside: avoid; }
          .callout { break-inside: avoid; }
          .no-break { break-inside: avoid; }
        }
      `}</style>

      <div className="report-wrap">

        {/* ── COVER ── */}
        <div className="cover">
          <div>
            <div className="cover-logo">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <rect width="44" height="44" rx="12" fill="#10b981"/>
                <text x="22" y="30" textAnchor="middle" fill="white" fontSize="22" fontWeight="800" fontFamily="DM Sans, sans-serif">L</text>
              </svg>
              <div>
                <div className="cover-logo-text">Laksh</div>
                <div className="cover-logo-sub">Sports Trading Platform</div>
              </div>
            </div>
            <div className="cover-rule" />
            <div className="cover-tag">Investor & Founder Brief · Confidential</div>
            <h1 className="cover-title">
              The Real-Time<br />
              <span>Stock Market</span><br />
              for NBA Players
            </h1>
            <p className="cover-subtitle">
              A continuous prediction market where participants buy and sell player shares across a full NBA season. Fixed prize pool. Proportional payout. Provably solvent.
            </p>
            <div className="cover-meta-grid">
              {[
                { label: 'Stage', value: 'Private Beta' },
                { label: 'Pool Structure', value: 'Parimutuel' },
                { label: 'Platform Rake', value: '5%' },
                { label: 'Payout Date', value: 'Jun 15, 2026' },
              ].map(m => (
                <div key={m.label} className="cover-meta-cell">
                  <div className="cover-meta-label">{m.label}</div>
                  <div className="cover-meta-value">{m.value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cover-footer">
            <span>April 2026</span> · Confidential — not for distribution · All cash and pool balances are currently virtual
          </div>
        </div>

        {/* ── TOC ── */}
        <div className="toc-page">
          <div className="section-label">Contents</div>
          {[
            ['1', 'Executive Summary'],
            ['2', 'Product Overview'],
            ['3', 'Market Design & Mechanics'],
            ['4', 'Settlement Model'],
            ['5', 'Technical Architecture'],
            ['6', 'Pricing Engine Deep Dive'],
            ['7', 'Competitive Landscape'],
            ['8', 'Business Model & Monetization'],
            ['9', 'Risks & Challenges'],
            ['10', 'Product Roadmap'],
            ['11', 'How to Pitch This'],
          ].map(([n, t]) => (
            <div key={n} className="toc-row">
              <span className="toc-num">{n}.</span>
              <span className="toc-title">{t}</span>
            </div>
          ))}
        </div>

        {/* ── 1. EXECUTIVE SUMMARY ── */}
        <div className="section page-break">
          <div className="section-label">Section 01</div>
          <h1>Executive Summary</h1>

          <h3>What it is</h3>
          <p>Laksh is a <strong>continuous-outcome prediction market for NBA player season performance</strong>, structured as a parimutuel pool competition. Users buy and sell fractional shares in individual players. Share prices are determined jointly by an on-platform automated market maker and an independent statistical oracle. At season end — June 15, 2026 — the entire prize pool is distributed proportionally based on each participant's portfolio mark-to-market value. Outperform the field, walk away with more than you put in. Underperform, and you subsidize the winners.</p>

          <h3>Why it matters</h3>
          <p>The global sports betting market exceeds $230 billion annually. The prediction market sector (Polymarket, Kalshi) has demonstrated that retail participants will engage deeply with probabilistic financial instruments when framing and UI are right. Laksh sits in a gap neither space currently occupies: a <strong>continuous, season-long, skill-differentiated</strong> product. Sports betting is episodic and luck-dominant. Prediction markets require binary framing that poorly captures complex outcomes like "how good will a player be." Laksh frames it correctly — as a market.</p>

          <h3>What makes it novel</h3>
          <p><strong>1. The instrument is correct.</strong> A player's seasonal arc is genuinely complex and information-rich. Laksh creates a real-time price series for that arc — one that updates on live game stats, injury reports, and trade volume simultaneously. This is not a binary bet; it is a market microstructure problem that rewards skill and information edge.</p>
          <p><strong>2. The settlement model is economically honest.</strong> Most fantasy/prediction platforms either create money from thin air or use house-backed payouts. Laksh uses a parimutuel pool: every dollar in the prize pool came from a participant. The 5% rake is explicit and upfront. Nothing is created from nothing. This is the only model that is genuinely solvent at scale without counterparty risk.</p>
          <p><strong>3. The pricing engine is sophisticated.</strong> Laksh uses a three-component blended price: automated market maker (15%), statistical fair value oracle (65%), and 30-minute TWAP (20%). The dominant role of the oracle means that even a well-capitalized manipulator cannot meaningfully move the settlement price without altering the underlying stat oracle, which is independently sourced from BallDontLie.</p>

          <div className="stat-row">
            {[
              { label: 'Active Players', value: '15' },
              { label: 'Pool Rake', value: '5%' },
              { label: 'Price Updates', value: '5s' },
              { label: 'Oracle Weight', value: '65%' },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-card-label">{s.label}</div>
                <div className="stat-card-value">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 2. PRODUCT OVERVIEW ── */}
        <div className="section page-break">
          <div className="section-label">Section 02</div>
          <h1>Product Overview</h1>

          <h3>User Journey</h3>
          <p><strong>Onboarding.</strong> Users apply via waitlist. Email is checked against an approved list on signup. Approved users are granted access and credited $10,000 in virtual starting balance, which simultaneously enters the season prize pool (less 5% rake = $9,500 to the distribution pool).</p>
          <p><strong>Home Screen.</strong> A grid of all 15 active players with live prices updating every 5 seconds, 24h price change, and sparkline charts. A ticker at the top shows real-time player prices in a scrolling feed.</p>
          <p><strong>Player Detail.</strong> Tapping a player opens a full detail view: price chart (1H / 8H / 24H / 1W / ALL), core stats (PPG / APG / RPG), fair value vs current price, AI-generated daily outlook, real-time news feed, injury status badge, and trade panel.</p>
          <p><strong>Trading.</strong> User enters a dollar amount. Before confirming, a real-time trade preview shows the exact breakdown: total spent → transaction fee → net into shares → shares received → price per share vs market price. Fill penalty warnings appear if heavy same-direction trading was recent. Trades execute instantly with no order book or counterparty matching.</p>
          <p><strong>Portfolio.</strong> Displays total portfolio value (cash + marked-to-market positions), unrealized P&L per player, realized P&L from past sells. Refreshes every 6 seconds.</p>
          <p><strong>Leaderboard.</strong> Rankings by total portfolio return. The motivational core — participants know exactly where they stand and how that maps to their pool payout.</p>

          <div className="callout">
            <p><strong>Core UX constraints:</strong> No order book. No counterparty matching. No shorting. No leverage. Trades execute instantly at the current market price. Share counts are fractional to 6 decimal places.</p>
          </div>
        </div>

        {/* ── 3. MARKET DESIGN ── */}
        <div className="section page-break">
          <div className="section-label">Section 03</div>
          <h1>Market Design & Mechanics</h1>

          <h3>What Users Are Buying</h3>
          <p>A Laksh share is <strong>a fractional claim on a player's expected final season value</strong>, priced continuously by a blended mechanism. It is not a binary bet and not a futures contract. The closest analogy is a continuously-traded prediction market where the outcome is a real-valued score derived from a player's full season statistics. Shares are long-only — <code>shares_owned &ge; 0</code> is enforced at the DB constraint level.</p>

          <h3>The Three-Component Price Blend</h3>
          <p>Every 5 seconds, a price tick runs on the server. The final displayed price is a weighted blend of three independent signals:</p>
          <pre>{`blended_price = w_AMM × AMM_spot + w_FV × FairValue + w_TWAP × TWAP_30min

Neutral weights:  15% AMM  /  65% FairValue  /  20% TWAP`}</pre>

          <p>These weights shift dynamically:</p>
          <table>
            <thead><tr><th>Condition</th><th>Effect</th></tr></thead>
            <tbody>
              {[
                ['High volatility', 'AMM weight decreases, FV weight increases'],
                ['No trades for >5 minutes', 'AMM weight decays toward 0 (5-min exponential half-life)'],
                ['30-min volume ≥3× normal', 'TWAP weight zeroed, shifts to FV (anti-echo-pump)'],
                ['Within 2 weeks of settlement', 'FV gains up to +50% weight bonus'],
                ['Final settlement', 'FV is 80–90% of price'],
              ].map(([c, e]) => (
                <tr key={c}><td>{c}</td><td>{e}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="callout">
            <p><strong>Key manipulation resistance:</strong> A pump that moves the AMM component by 15% only moves the blended price by 15% × 15% = <strong>2.25%</strong>, since FV is unaffected by trading activity.</p>
          </div>

          <h3>AMM Mechanics: Constant Product Market Maker</h3>
          <p>Each player has a virtual liquidity pool with reserves <code>pool_x</code> (shares) and <code>pool_y</code> (dollars). The invariant is <code>pool_x × pool_y = k</code>. Spot price = <code>pool_y / pool_x</code>.</p>
          <p>When a user buys $D after fees:</p>
          <pre>{`new_pool_y = pool_y + D
new_pool_x = k / new_pool_y
shares_received = pool_x - new_pool_x
effective_price = D / shares_received`}</pre>
          <p>Price impact uses <strong>quadratic slippage</strong> (exponent = 2.0):</p>
          <pre>{`impact = (D / (market_depth + D))²`}</pre>
          <table>
            <thead><tr><th>Trade Size</th><th>Raw Impact</th><th>Status</th></tr></thead>
            <tbody>
              {[
                ['$1,000', '0.015%', 'Normal'],
                ['$5,000', '0.38%', 'Normal'],
                ['$10,000', '1.36%', 'Normal'],
                ['$20,000', '5.0% cap', 'Blocked above this'],
                ['$50,000', '—', 'Blocked'],
              ].map(([t, i, s]) => (
                <tr key={t}><td>{t}</td><td>{i}</td><td>{s}</td></tr>
              ))}
            </tbody>
          </table>
          <p>A <strong>compare-and-swap</strong> on <code>pool_x</code> prevents race conditions: if <code>pool_x</code> changed between read and write, the trade rolls back atomically.</p>

          <h3>Virtual Market Depth</h3>
          <p>Base depth starts at $80,000 and grows to ~$240,000 by season end:</p>
          <pre>{`maturity_depth = $80k × (1 + season_progress × 2.0)
// + proximity bonus when price is near FV
// + volume bonus from organic 24h trading`}</pre>
          <p>This is a <em>virtual resistance parameter</em>, not real liquidity. Doubling the depth doubles the capital required to achieve any given price impact.</p>

          <h3>Fair Value Oracle</h3>
          <p>The fair value is a Bayesian-shrunk, injury-adjusted, live-boosted statistical estimate:</p>
          <pre>{`// Step 1: Raw score from season stats (projected to 82 games)
raw_score = (proj_pts / 2800) × 0.35
           + (proj_ast / 900)  × 0.20
           + (proj_reb / 1200) × 0.20
           + (proj_eff / 3000) × 0.25

// Step 2: Bayesian shrinkage toward player-specific prior
credibility = min(games_played / 20, 1.0)
shrunk      = credibility × raw_score + (1 − credibility) × prior

// Step 3: Availability discount (if behind expected games pace)
availability = 0.5 + 0.5 × (games_played / expected_games)

// Step 4: Injury multiplier (from BallDontLie report)
//   Out For Season: ×0.30  |  Out: ×0.60  |  Doubtful: ×0.80

// Step 5: Live game boost (±15% during active games)
FV = max($5, evScore × $0.40 × injury_mult × (1 + boost × 0.15))`}</pre>

          <h3>Live Game Integration</h3>
          <p>BallDontLie API is polled every ~60 seconds. New stat events generate direct price bumps:</p>
          <table>
            <thead><tr><th>Event</th><th>Price Impact</th></tr></thead>
            <tbody>
              {[
                ['Point scored', '+0.06%'],
                ['Assist', '+0.08%'],
                ['Rebound', '+0.03%'],
                ['Steal', '+0.10%'],
                ['Block', '+0.08%'],
                ['Turnover', '−0.05%'],
              ].map(([e, i]) => (
                <tr key={e}><td>{e}</td><td>{i}</td></tr>
              ))}
            </tbody>
          </table>
          <p>A single sync is capped at ±5%. A 30-point, 10-assist, 10-rebound game polled at once: +2.9% ≈ +$8 on a $300 share.</p>

          <h3>Manipulation Defenses</h3>
          <table>
            <thead><tr><th>Attack Vector</th><th>Defense</th></tr></thead>
            <tbody>
              {[
                ['Direct pump (large buys)', 'Quadratic slippage + 5% cap + circuit breaker'],
                ['Slow accumulation ($4,999 every 5 min)', 'Decaying pressure score, 30-min half-life'],
                ['TWAP manipulation (sustained spike)', 'Anomaly detector: ≥3× volume → TWAP weight → 0'],
                ['Wash trading', '30-min round-trip detection; >70% round-trip → blocked'],
                ['Market cornering', 'Position concentration gate: no account >10% of float'],
                ['Sybil attack (multi-account)', 'IP-shared pressure via Postgres RPC'],
                ['Settlement manipulation', 'Settlement = 80% oracle + 20% TWAP_7day; max ≈3% impact'],
              ].map(([a, d]) => (
                <tr key={a}><td>{a}</td><td>{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── 4. SETTLEMENT ── */}
        <div className="section page-break">
          <div className="section-label">Section 04</div>
          <h1>Settlement Model</h1>

          <h3>How It Works</h3>
          <p>Laksh uses a <strong>parimutuel pool</strong> settlement:</p>
          <ol>
            <li>Every participant's $10,000 entry goes into a shared prize pool.</li>
            <li>Platform takes <strong>5% rake upfront</strong> ($500/participant).</li>
            <li><strong>Distribution pool</strong> = total deposits × 95%.</li>
            <li>At settlement, each player's price is computed: <code>0.80 × FinalFV + 0.20 × TWAP_7day</code></li>
            <li>Each user's MTM = <code>cash_balance + Σ(shares × settlement_price)</code></li>
            <li>Each user's payout = <code>(user_MTM / Σ all MTMs) × distribution_pool</code></li>
          </ol>
          <div className="callout">
            <p><strong>Example.</strong> 100 users × $10k = $1M. 5% rake = $50k. Distribution pool = $950k. If your portfolio MTM is $15k and the average is $10k, you receive $15k/$1M × $950k = <strong>$14,250</strong> — a 42.5% net return.</p>
          </div>

          <h3>Mid-Season Withdrawal</h3>
          <p>Users who exit before settlement receive: <code>payout = portfolio_MTM × 0.97</code>. The 3% early exit fee stays in the pool — it increases payouts for everyone who remains. This is incentive-compatible: it penalizes early exit while rewarding patience.</p>

          <h3>Why Parimutuel vs Alternatives</h3>
          <table>
            <thead><tr><th>Model</th><th>Problem</th></tr></thead>
            <tbody>
              {[
                ['Formula settlement (shares × price)', 'Creates money from thin air. 10 users deposit $100k but receive $150k if prices pumped. Insolvent.'],
                ['Sports betting (house-backed)', 'Requires massive house capital. Not scalable without counterparty risk management.'],
                ['Per-game fantasy', 'Short time horizon eliminates information edge. Luck-dominant.'],
                ['Binary prediction market', 'Poorly captures complex numeric outcomes.'],
                ['Parimutuel (Laksh)', 'Provably solvent. Platform revenue predictable. Rewards relative skill.'],
              ].map(([m, p]) => (
                <tr key={m}><td><strong>{m}</strong></td><td>{p}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── 5. TECH ARCHITECTURE ── */}
        <div className="section page-break">
          <div className="section-label">Section 05</div>
          <h1>Technical Architecture</h1>

          <h3>Stack</h3>
          <table>
            <thead><tr><th>Layer</th><th>Technology</th><th>Notes</th></tr></thead>
            <tbody>
              {[
                ['Frontend', 'Next.js 14 (App Router)', 'React Server + Client Components'],
                ['Auth', 'Supabase Auth + @supabase/ssr', 'Sessions via cookies'],
                ['Database', 'Supabase (PostgreSQL 15)', 'RLS selectively enabled'],
                ['Real-time', 'Client-side polling', 'Portfolio: 6s · Prices: 5s · Leaderboard: 30s'],
                ['Deployment', 'Vercel', 'Edge API routes'],
                ['Cron', 'Vercel Cron + x-cron-secret', 'Price tick: 5s · Stats sync: 60s'],
                ['External data', 'BallDontLie API', 'Season averages, live scores, injuries'],
                ['AI', 'Claude API', 'Daily player outlook digest'],
              ].map(([l, t, n]) => (
                <tr key={l}><td><strong>{l}</strong></td><td><code>{t}</code></td><td>{n}</td></tr>
              ))}
            </tbody>
          </table>

          <h3>Core Database Schema</h3>
          <pre>{`users          — balance, initial_balance, is_approved
players        — current_price, pool_x, pool_y, fair_value,
                 twap_price, volatility, market_depth,
                 momentum_breaker_*, ppg/apg/rpg/efficiency,
                 injury_*, live_game_boost, live_stats_snapshot
positions      — user_id + player_id → shares_owned,
                 avg_cost_basis, realized_pnl
trades         — side, shares, price, total_value,
                 realized_pnl, trade_ip (audit trail)
price_history  — 5s snapshots: price, volatility (7-day TTL)
live_stat_cache — BDL poller writes; live-stats.ts reads
season_pool    — total_deposited, rake_collected,
                 distribution_pool, early_exit_fees
user_deposits  — full audit trail: deposits/withdrawals/settlement`}</pre>

          <h3>Data Flow</h3>
          <pre>{`BDL API (external)
  ↓ every ~60s (Vercel Cron)
bdl-poller → live_stat_cache
  ↓ every ~60s (separate cron)
syncLiveBoosts() → players.current_price + players.live_game_boost
  ↓ every 5s (Vercel Cron)
/api/prices/tick:
  1. Read all active players + last 35min price history
  2. computeFairValue()     → stat oracle
  3. computeBlendWeights()  → dynamic AMM/FV/TWAP ratios
  4. Drift AMM spot toward FV + Gaussian noise
  5. Blend price
  6. Check momentum circuit breaker
  7. Update players table + write price_history row

User trade (buy/sell):
  /api/trade:
  1. Rate limit (10/min global)
  2. Anti-manipulation gate
  3. computeAMMTrade()       → immediate price impact
  4. CAS balance update      → optimistic concurrency
  5. Position upsert
  6. Trade record insert
  7. CAS pool_x update       → retry if concurrent trade`}</pre>
        </div>

        {/* ── 6. PRICING ENGINE DEEP DIVE ── */}
        <div className="section page-break">
          <div className="section-label">Section 06</div>
          <h1>Pricing Engine Deep Dive</h1>

          <h3>Full Tick Loop (Pseudocode)</h3>
          <pre>{`for each active player p:
  fv     = computeFairValue(p)           # oracle
  vol    = computeVol(history[-30:])     # EWMA, λ=0.94
  twap   = computeTWAP(history, 30min)
  depth  = computeMarketDepth(p, fv, vol24h)
  weights = computeBlendWeights(vol, timeSinceTrade, hts)
  # weights.wAmm / wFv / wTwap (sum to 1.0)

  # Drift AMM spot toward FV (rubber-band effect)
  deviation = (ammSpot - fv) / fv
  alpha = drift_base + drift_season_boost × seasonProgress
  if |deviation| > 0.08:
      alpha += 0.5 × (|deviation| - 0.08)   # extra pull far from FV
  noise     = vol × price × randn() × noise_scale
  newAmmSpot = ammSpot × (1 - alpha) + fv × alpha + noise

  blended = wAmm × newAmmSpot + wFv × fv + wTwap × twap

  # Momentum breaker
  if priceRise_30min > 8%:
      mark momentum_breaker_active = true  # buys blocked 10 min

  update players; insert price_history`}</pre>

          <h3>No-Game Pricing (Ornstein-Uhlenbeck)</h3>
          <p>When no NBA game is in progress, the system routes to a separate model to keep prices visually alive without creating exploitable drift:</p>
          <pre>{`P(t+1) = P(t) + α_eff × (FV − P(t)) + σ_eff × Z_clamped
# α = 0.004/tick (half-life ≈ 14 min)
# σ = $0.20/tick on a $200 player
# Drift < Noise → any fee-paying drift strategy loses money`}</pre>

          <h3>Edge Cases</h3>
          <ul>
            <li><strong>Season start (0 games played):</strong> Credibility = 0, FV defaults to player-specific prior. Depth floor = $50k. Wild early swings are contained.</li>
            <li><strong>Concurrent trades:</strong> CAS on <code>pool_x</code>. Second simultaneous trade fails CAS and returns "retry." Full rollback on any subsequent step failure.</li>
            <li><strong>Settlement crash recovery:</strong> Distributed lock via <code>claim_settlement()</code>. Players are marked settled <em>only after</em> all positions are credited — crash-resume safe.</li>
            <li><strong>Injured star (season-ending):</strong> Injury discount ×0.30. FV drops immediately on next BDL sync. Holders who don't sell will see their settlement price reflect the injury.</li>
          </ul>
        </div>

        {/* ── 7. COMPETITION ── */}
        <div className="section page-break">
          <div className="section-label">Section 07</div>
          <h1>Competitive Landscape</h1>

          <h3>Kalshi</h3>
          <p>CFTC-licensed prediction market offering binary and range outcome contracts on events including sports, economics, and politics.</p>
          <p><strong>Laksh advantage:</strong> Continuous price discovery vs periodic binary resolution. Richer outcome expression. More engaging UX with portfolio management and live game updates.</p>
          <p><strong>Kalshi advantage:</strong> Federal regulatory legitimacy. Institutional order flow and real market makers. Legal real-money operation in all US states.</p>

          <h3>Polymarket</h3>
          <p>Crypto-native prediction market on Polygon. $1B+ volume in 2024 elections. Order book / AMM hybrid.</p>
          <p><strong>Laksh advantage:</strong> No crypto wallet required — dramatically lower onboarding friction. Sports-native product vs generalist market. Season-long retention vs one-time events.</p>
          <p><strong>Polymarket advantage:</strong> Real money, real liquidity, proven scale. Outcomes are simple and binary. DeFi composability.</p>

          <h3>DraftKings / FanDuel</h3>
          <p>Daily fantasy and sportsbooks. Dominant consumer sports gaming platforms with 40-state licensing and massive marketing budgets.</p>
          <p><strong>Laksh advantage:</strong> Season-long engagement vs exhausting nightly contests. Real skill expression across 15 players vs luck-dominant single slates. No per-bet vigorish. Intellectually engaging "stock market" framing.</p>
          <p><strong>DK/FD advantage:</strong> Instant gratification. Legal everywhere. Established brands. Parlay upside moments.</p>

          <div className="callout">
            <p><strong>The white space:</strong> Nobody has built for the sports enthusiast who wants season-long, skill-differentiated engagement — the person who has been in a fantasy league for 15 years but finds DFS exhausting and sports betting unsatisfying. That user is a natural Laksh participant and currently has no purpose-built product.</p>
          </div>
        </div>

        {/* ── 8. BUSINESS MODEL ── */}
        <div className="section page-break">
          <div className="section-label">Section 08</div>
          <h1>Business Model & Monetization</h1>

          <h3>Revenue Streams</h3>
          <p><strong>1. Pool rake (primary).</strong> 5% of every participant's entry deposit. In a platform with 1,000 users × $10,000 = $10M in deposits, rake = <strong>$500,000</strong> — guaranteed revenue earned upfront on deposit regardless of outcomes.</p>
          <p><strong>2. Dynamic trading fees (secondary).</strong> Every trade incurs 0.2%–5%:</p>
          <pre>{`fee = 0.2% × (1 + 3 × |price/FV - 1|) × (1 + 2 × vol/target_vol)
// Manipulators pay more. Fair-value trades pay base rate.`}</pre>
          <p>Estimated at $50k avg daily volume × 15 players × 0.5% avg fee = ~$450k/season in fee revenue.</p>
          <p><strong>3. Early exit fees.</strong> 3% on mid-season NAV withdrawals — stays in prize pool, not a direct revenue line. Aligns platform with long-term participation.</p>

          <h3>Revenue at Scale</h3>
          <table>
            <thead><tr><th>Users</th><th>Deposits</th><th>Rake (5%)</th><th>Est. Trading Fees</th><th>Total / Season</th></tr></thead>
            <tbody>
              {[
                ['500', '$5M', '$250k', '$225k', '~$475k'],
                ['2,000', '$20M', '$1M', '$900k', '~$1.9M'],
                ['10,000', '$100M', '$5M', '$4.5M', '~$9.5M'],
                ['50,000', '$500M', '$25M', '$22.5M', '~$47.5M'],
              ].map(r => (
                <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>

          <h3>Real Money Path</h3>
          <p>Moving to real money requires either state-by-state DFS licensing or CFTC registration as a derivatives exchange. The competitive DFS licensing path (used by FanDuel/DraftKings) treats Laksh as a "contest of skill" — the parimutuel structure and explicit skill component (portfolio selection + timing) support this framing. This is not legal advice and requires independent counsel.</p>
          <p>With multi-sport expansion (NBA + NFL simultaneously), the model runs two prize pools year-round — materially increasing revenue density without changing unit economics.</p>
        </div>

        {/* ── 9. RISKS ── */}
        <div className="section page-break">
          <div className="section-label">Section 09</div>
          <h1>Risks & Challenges</h1>
          <p><em>Written from the perspective of a skeptical investor. These are genuine concerns, not softened for the pitch.</em></p>

          <h3>Technical Risks</h3>
          <div className="risk-item medium">
            <div className="risk-label">Medium · Technical</div>
            <div className="risk-title">Pricing engine model risk</div>
            <div className="risk-body">The fair value oracle uses fixed weight parameters and stat maximums. If a player's performance falls outside calibrated ranges, or if formula weights are wrong, FV diverges from market consensus and creates exploitable arbitrage. Requires ongoing calibration as the season progresses.</div>
          </div>
          <div className="risk-item medium">
            <div className="risk-label">Medium · Infrastructure</div>
            <div className="risk-title">Supabase as single point of failure</div>
            <div className="risk-body">All state lives in one Supabase project. No read replica, no cross-region failover. A Supabase outage during settlement would be catastrophic for trust — though not financially, since settlement is an atomic DB operation.</div>
          </div>
          <div className="risk-item low">
            <div className="risk-label">Low · Infrastructure</div>
            <div className="risk-title">5-second cron reliability</div>
            <div className="risk-body">Vercel's minimum cron interval is 1 minute. The 5-second tick is achieved via self-invocation. Late or skipped ticks create price staleness. At high user counts with active trading, even 30-second staleness matters.</div>
          </div>

          <h3>Market Design Risks</h3>
          <div className="risk-item high">
            <div className="risk-label">High · Market Structure</div>
            <div className="risk-title">Thin float problem</div>
            <div className="risk-body">With only 15 players and no seed liquidity, early users define the entire market cap. The first buyer of Giannis at $325 is pricing against no competing opinion. Virtual depth provides resistance, but it is synthetic — there is no real counterparty ensuring fair prices early in the season.</div>
          </div>
          <div className="risk-item medium">
            <div className="risk-label">Medium · Market Structure</div>
            <div className="risk-title">Oracle dependence</div>
            <div className="risk-body">Fair value is ~65% of price and 80% of settlement. If BallDontLie data is wrong (box score lags, corrections), or if the formula is wrong for edge cases (player changes role, new team), fair value is misleading and settlement prices may feel unfair to participants.</div>
          </div>
          <div className="risk-item medium">
            <div className="risk-label">Medium · Behavioral</div>
            <div className="risk-title">Parimutuel reduces trading incentive</div>
            <div className="risk-body">In a parimutuel market, payout depends on relative performance. A user up 20% when everyone else is up 30% is a net loser. This "benchmark risk" is cognitively more complex than standard betting and may reduce trading frequency and engagement compared to absolute-return games.</div>
          </div>
          <div className="risk-item high">
            <div className="risk-label">High · Product</div>
            <div className="risk-title">Player supply is too small</div>
            <div className="risk-body">15 players is insufficient for meaningful diversification or strategy. A user who correctly picks 2 stars can ride those to the leaderboard top without sophisticated multi-player strategy. Real pool competition requires at least 50–100 players.</div>
          </div>

          <h3>Regulatory Risk</h3>
          <div className="risk-item high">
            <div className="risk-label">High · Existential (Real Money)</div>
            <div className="risk-title">Regulatory classification is unresolved</div>
            <div className="risk-body">Depending on jurisdiction, Laksh may qualify as a gambling operation (requiring gaming license), a skill game contest (DFS framework), or a commodity derivatives exchange (CFTC jurisdiction). The continuous trading market structure is novel enough that existing legal frameworks don't map cleanly. With virtual money in beta, risk is near-zero. Transition to real money requires careful legal structuring before any launch.</div>
          </div>

          <h3>User Behavior Risks</h3>
          <div className="risk-item high">
            <div className="risk-label">High · Retention</div>
            <div className="risk-title">Season-long patience is a hard sell</div>
            <div className="risk-body">Most users are conditioned by DFS and sports betting for immediate gratification. A season ending June 2026 requires attention across months without winning or losing. Day-30 retention through a six-month season is the single biggest product challenge — and it has never been demonstrated at scale in this format.</div>
          </div>
        </div>

        {/* ── 10. ROADMAP ── */}
        <div className="section page-break">
          <div className="section-label">Section 10</div>
          <h1>Product Roadmap</h1>

          <h3>Before Beta Launch (Critical)</h3>
          <ol>
            <li><strong>Expand player roster to 50–100.</strong> 15 players is insufficient for meaningful strategy or diversification. This is the single most impactful product improvement available.</li>
            <li><strong>Pool status dashboard.</strong> Users need to see the prize pool size, their rank, their estimated payout if the season ended today, and the leaderboard mapped to actual dollar outcomes.</li>
            <li><strong>Mobile optimization.</strong> The platform is used while watching games. Fast-path trading on mobile is essential.</li>
            <li><strong>Oracle calibration.</strong> Back-test the FV formula against historical stats to verify derived FVs match reasonable expectations across different player archetypes and performance scenarios.</li>
            <li><strong>Trade history with full fee breakdown.</strong> Users who don't trust the fee calculation will churn. Show every fee, fill penalty, and cent.</li>
          </ol>

          <h3>Beta Success Metrics</h3>
          <ul>
            <li>200+ approved users completing ≥5 trades in first two weeks</li>
            <li>Average session length &gt;4 minutes</li>
            <li>Day-30 retention &gt;25%</li>
            <li>Zero pricing bugs causing materially wrong settlement prices</li>
            <li>Zero fund loss from race conditions or settlement errors</li>
          </ul>

          <h3>Post-Beta</h3>
          <ol>
            <li>Expand to NFL and/or MLB with the same engine</li>
            <li>Multi-sport simultaneous pools (NBA + NFL in September–October)</li>
            <li>Social features: public portfolios, following traders, commentary</li>
            <li>Tiered pools: beginner, advanced, eventually real-money tournaments</li>
            <li>API / data layer: publish player price feeds as a data product</li>
            <li>Real-money DFS licensing in the 24 currently legal states</li>
          </ol>
        </div>

        {/* ── 11. PITCH ── */}
        <div className="section page-break">
          <div className="section-label">Section 11</div>
          <h1>How to Pitch This</h1>

          <div className="pitch-box">
            <div className="pitch-box-label">30-Second Pitch</div>
            <p>"Laksh is a real-time stock market for NBA players. You start with $10,000 in a shared prize pool, buy and sell player shares as the season unfolds, and at the end, the pool is distributed proportionally — best portfolio takes the most. It's the only sports product that rewards sustained conviction and skill over a full season instead of a single game. We're in private beta now."</p>
          </div>

          <div className="pitch-box">
            <div className="pitch-box-label">2-Minute Pitch</div>
            <p>"Sports betting generates $230 billion a year, but it's fundamentally broken for skilled players — the house takes 8–10% on every bet, you need to be right on every game, and there's no compounding information edge.</p>
            <p style={{marginTop: 8}}>Prediction markets like Polymarket and Kalshi are interesting, but they force binary yes/no framing onto complex outcomes. Is Giannis going to have a great season? That's not a binary question.</p>
            <p style={{marginTop: 8}}>Laksh frames it correctly: as a market. Every NBA player has a live share price — updated every five seconds, driven by season stats, live game performance, and real trading. You build a portfolio, make tactical decisions across the season, and at the end, a fixed prize pool is distributed proportionally based on portfolio performance. Best players in the pool walk away with more than they put in.</p>
            <p style={{marginTop: 8}}>The economics are honest: 5% rake on deposits, 0.2–5% trading fees, and no money created from thin air. The settlement model is parimutuel — we don't need a house to back payouts because the prize pool is fixed from the start.</p>
            <p style={{marginTop: 8}}>We're in beta with virtual money. We plan to move to real-money DFS-licensed contests in 2026. The next step is expanding from 15 to 100 players and building the social layer that makes this as engaging as the actual game."</p>
          </div>

          <h3>5 Key Talking Points</h3>

          <div className="risk-item" style={{borderLeftColor: '#10b981'}}>
            <div className="risk-label">Talking Point 1</div>
            <div className="risk-title">"The instrument is correct."</div>
            <div className="risk-body">Sports betting forces binary outcomes on continuous phenomena. Prediction markets approximate continuous outcomes with clunky yes/no contracts. Laksh creates a genuinely continuous market — the only honest way to represent a player's full-season arc.</div>
          </div>
          <div className="risk-item" style={{borderLeftColor: '#10b981'}}>
            <div className="risk-label">Talking Point 2</div>
            <div className="risk-title">"Settlement is provably solvent."</div>
            <div className="risk-body">Prior "stock market for sports" products all face the same fatal flaw: if prices go up, where does the extra payout money come from? The parimutuel pool solves this permanently. Total payouts = fixed pool. No counterparty risk.</div>
          </div>
          <div className="risk-item" style={{borderLeftColor: '#10b981'}}>
            <div className="risk-label">Talking Point 3</div>
            <div className="risk-title">"Manipulation is solved better than any competitor."</div>
            <div className="risk-body">Four layers: oracle-dominant pricing (65% FV, unaffected by trading), quadratic slippage costs, multi-layer anti-manipulation gates, and a settlement price that is 80% oracle-driven. Controlling 100% of market activity for a full week moves settlement by at most 3%.</div>
          </div>
          <div className="risk-item" style={{borderLeftColor: '#10b981'}}>
            <div className="risk-label">Talking Point 4</div>
            <div className="risk-title">"The user base is genuinely underserved."</div>
            <div className="risk-body">DraftKings and FanDuel compete for the same episodic bettor. Nobody has built for the sports enthusiast who tracks stats, has real opinions about player trajectories, and wants season-long engagement. That user — the 15-year fantasy veteran — is a natural Laksh participant with no purpose-built product today.</div>
          </div>
          <div className="risk-item" style={{borderLeftColor: '#10b981'}}>
            <div className="risk-label">Talking Point 5</div>
            <div className="risk-title">"The timing is right."</div>
            <div className="risk-body">Kalshi's CFTC victory and the Supreme Court's 2018 sports betting ruling have done the regulatory groundwork. Real-money prediction markets are becoming legitimate. Laksh can build the product, the user base, and the engagement loop in virtual mode, then flip to real money with existing licensing frameworks when ready.</div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div style={{marginTop: 48, paddingTop: 24, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div style={{fontSize: '8pt', color: '#94a3b8'}}>
            Laksh Sports Trading Platform · April 2026<br />
            <span style={{color: '#cbd5e1'}}>Confidential — not for distribution</span>
          </div>
          <div style={{fontSize: '8pt', color: '#94a3b8', textAlign: 'right'}}>
            All cash and pool balances are currently virtual.<br />
            Nothing in this document constitutes financial or legal advice.
          </div>
        </div>

      </div>

      <DownloadButton />
    </>
  );
}
