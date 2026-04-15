'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth, usePlayers, usePriceTicker, usePortfolio, useCountdown } from '@/hooks';
import { Player } from '@/types';
import AuthForm from '@/components/AuthForm';
import WaitlistForm from '@/components/WaitlistForm';
import Header from '@/components/Header';
import LakshLogo from '@/components/LakshLogo';
import BottomNav from '@/components/BottomNav';
import HomeView from '@/components/HomeView';
import PlayerDetail from '@/components/PlayerDetail';
import PortfolioView from '@/components/PortfolioView';
import LeaderboardView from '@/components/LeaderboardView';
import ProfileView from '@/components/ProfileView';
import AboutView from '@/components/AboutView';

const SETTLEMENT_DATE = '2026-06-15T00:00:00Z';

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Join the pool',
    desc: 'Every participant starts with $10,000. That money enters a shared season pool — the total prize pot that gets paid out at the end.',
  },
  {
    step: '2',
    title: 'Trade player shares',
    desc: 'Buy and sell NBA player shares. Prices move with every trade and drift toward each player\'s stat-based expected value.',
  },
  {
    step: '3',
    title: 'Build a winning portfolio',
    desc: 'The better your portfolio performs relative to everyone else, the larger your share of the final payout.',
  },
  {
    step: '4',
    title: 'Get paid at season end',
    desc: 'On June 15, 2026, the pool is distributed proportionally. Top performers take home more than they put in.',
  },
];

const FEATURES = [
  {
    title: 'Live share prices',
    desc: 'Every player has a real-time price that updates every 5 seconds, driven by trading activity and live game stats.',
  },
  {
    title: 'Fixed prize pool',
    desc: 'All deposits go into one pool. The platform takes a 5% rake upfront — the rest is yours to compete for. No money is created from thin air.',
  },
  {
    title: 'Proportional payout',
    desc: 'At season end, the pool is split based on portfolio value. Outperform the field and you take home more than you started with.',
  },
  {
    title: 'Stat-driven prices',
    desc: 'Prices drift toward each player\'s stat-based expected value. Points, assists, and rebounds all factor in — live.',
  },
  {
    title: 'Exit anytime',
    desc: 'Need to cash out early? Withdraw at your current portfolio value minus a 3% early exit fee. The fee stays in the pool for everyone else.',
  },
  {
    title: 'Leaderboard',
    desc: 'Rankings are based on total portfolio return. The top of the board at settlement takes the biggest slice of the pool.',
  },
];

function useScrollReveal() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('visible'); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useScrollReveal();
  return <div ref={ref} className={`landing-fade-up opacity-0 ${className}`}>{children}</div>;
}

function LandingPage({ onStart }: { onStart: () => void }) {
  const [navScrolled, setNavScrolled] = useState(false);
  const { players } = usePlayers();
  const countdown = useCountdown(SETTLEMENT_DATE);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const tickerItems = useMemo(() => {
    if (!players?.length) {
      return ['LAL','GSW','MIL','BOS','OKC','DEN'].map((sym, i) => ({
        name: sym, price: 245 + i * 18, change: i % 2 === 0 ? 2.4 : -1.1,
      }));
    }
    return players.slice(0, 8).map(p => ({
      name: p.name.split(' ').pop()!,
      price: p.current_price,
      change: p.price_change_pct_24h,
    }));
  }, [players]);

  return (
    <div className="relative overflow-hidden min-h-screen bg-lk-bg text-white">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 landing-grid" />
        <div className="absolute inset-0 landing-glow" />
        <div className="absolute inset-0 landing-noise" />
      </div>

      <div className="relative z-10">
        {/* Nav */}
        <header className={`sticky top-0 z-30 transition duration-300 ${navScrolled ? 'backdrop-blur-xl bg-black/30 border-b border-white/10' : 'bg-transparent'}`}>
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <LakshLogo className="w-10 h-10" />
              <div>
                <div className="text-lg font-bold tracking-wider text-lk-text">Laksh</div>
                <div className="text-[9px] text-lk-dim tracking-[3px] uppercase -mt-0.5">The 24/7 Sports Market</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a href="/waitlist" className="rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
                Join Waitlist
              </a>
              <button onClick={onStart} className="rounded-full bg-lk-accent px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110">
                Sign In
              </button>
            </div>
          </div>
        </header>

        {/* Live ticker */}
        <div className="border-y border-white/5 bg-black/10 py-2.5 overflow-hidden">
          <div className="landing-ticker flex gap-5 whitespace-nowrap text-xs">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <div key={i} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/8 flex-shrink-0">
                <span className="font-semibold text-white">{item.name}</span>
                <span className="text-lk-dim">${item.price.toFixed(2)}</span>
                <span className={item.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <main className="mx-auto max-w-7xl px-6">

          {/* ── Hero ── */}
          <section className="py-24 lg:py-32">
            <div className="grid gap-16 lg:grid-cols-[1fr_420px] lg:items-center">

              <div className="space-y-8 max-w-2xl">
                {/* Settlement badge */}
                <div className="inline-flex items-center gap-2.5 rounded-full border border-lk-accent/25 bg-lk-accent/5 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-lk-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-lk-accent animate-pulse" />
                  Season settles June 15, 2026
                </div>

                <h1 className="text-5xl font-black tracking-tight sm:text-6xl lg:text-[4.5rem] leading-[1.05]">
                  Trade the<br />
                  <span className="bg-gradient-to-r from-emerald-300 via-cyan-200 to-sky-400 bg-clip-text text-transparent">
                    future of sports
                  </span>
                </h1>

                <p className="text-lg leading-8 text-lk-dim">
                  One shared prize pool. Build a portfolio of NBA players. Trade in real time and outperform everyone else. Get your share of the pool when the season ends June 15.
                </p>

                <div id="waitlist" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 max-w-md">
                  <p className="text-xs uppercase tracking-[0.4em] text-lk-accent mb-2">Beta access</p>
                  <p className="text-sm text-lk-dim mb-4">Drop your email and we'll let you in when spots open. Everyone starts with $10,000 in the prize pool.</p>
                  <WaitlistForm />
                </div>

                {/* Countdown */}
                <div className="flex items-center gap-4 pt-2">
                  <div className="h-px flex-1 bg-white/8" />
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-lk-dim mb-1">Time to settlement</div>
                    <div className="font-mono text-sm font-semibold text-lk-accent">{countdown}</div>
                  </div>
                  <div className="h-px flex-1 bg-white/8" />
                </div>
              </div>

              {/* Hero card — mock player */}
              <div className="relative">
                <div className="absolute -inset-4 rounded-[2.5rem] bg-lk-accent/5 blur-2xl" />
                <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 space-y-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Player</div>
                      <div className="font-bold text-lg">Ja Morant</div>
                      <div className="text-xs text-lk-dim">PG · Memphis Grizzlies</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-1">Share Price</div>
                      <div className="text-2xl font-bold">$245.30</div>
                      <div className="text-xs text-emerald-400 font-medium">↗ +4.6% today</div>
                    </div>
                  </div>

                  {/* Mini chart */}
                  <div className="h-24 rounded-2xl bg-black/30 overflow-hidden">
                    <svg viewBox="0 0 300 96" className="w-full h-full" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00d4aa" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#00d4aa" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d="M0 72 C30 68 60 60 90 62 C120 64 150 52 180 44 C210 36 240 28 300 18" fill="none" stroke="#00d4aa" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M0 72 C30 68 60 60 90 62 C120 64 150 52 180 44 C210 36 240 28 300 18 L300 96 L0 96Z" fill="url(#cg)"/>
                    </svg>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2">
                    {[{ l: 'PPG', v: '24.8' }, { l: 'APG', v: '8.1' }, { l: 'EFF', v: '23.9' }].map(s => (
                      <div key={s.l} className="rounded-xl bg-black/30 p-3 text-center">
                        <div className="text-[10px] text-lk-dim">{s.l}</div>
                        <div className="text-sm font-bold text-white mt-0.5">{s.v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Mock trade buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-lk-accent/15 border border-lk-accent/20 py-3 text-center text-sm font-semibold text-lk-accent">↗ Buy</div>
                    <div className="rounded-xl bg-lk-red/10 border border-lk-red/20 py-3 text-center text-sm font-semibold text-lk-red">↘ Sell</div>
                  </div>

                  <div className="text-[11px] text-lk-muted text-center">
                    Expected final value: <span className="text-lk-accent font-medium">$238.50</span> · Pool pays out Jun 15, 2026
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── How it works ── */}
          <section id="how" className="py-20 border-t border-white/5">
            <div className="max-w-xl mb-12">
              <p className="text-xs uppercase tracking-[0.4em] text-lk-accent mb-3">How it works</p>
              <h2 className="text-3xl font-bold">Simple from start to settlement.</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS.map((s, i) => (
                <Reveal key={s.step} className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
                  <div className="text-3xl font-black text-white/10 mb-4 leading-none">{String(i + 1).padStart(2, '0')}</div>
                  <div className="font-semibold text-sm mb-2">{s.title}</div>
                  <div className="text-xs leading-relaxed text-lk-dim">{s.desc}</div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ── Pool payout callout ── */}
          <Reveal className="my-4">
            <div className="rounded-[2rem] border border-emerald-500/20 bg-emerald-500/[0.04] p-10 grid gap-8 md:grid-cols-[1fr_auto] items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-emerald-400 mb-3">How the payout works</p>
                <h3 className="text-2xl font-bold mb-3">One pool. Distributed proportionally on June 15.</h3>
                <p className="text-sm leading-7 text-lk-dim max-w-lg">
                  Every participant's $10k goes into a shared prize pool. The platform takes a 5% rake upfront — the remaining 95% is the prize. At season end, each player receives a share of that pool proportional to how their portfolio performed versus the field. Outperform, and you walk away with more than you put in. No fake settlement math — the pool is fixed.
                </p>
              </div>
              <div className="text-center min-w-[160px]">
                <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-2">Payout in</div>
                <div className="font-mono text-xl font-bold text-emerald-300">{countdown}</div>
              </div>
            </div>
          </Reveal>

          {/* ── Features grid ── */}
          <section className="py-20 border-t border-white/5">
            <div className="max-w-xl mb-12">
              <p className="text-xs uppercase tracking-[0.4em] text-lk-accent mb-3">Platform</p>
              <h2 className="text-3xl font-bold">Everything you need to trade the season.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {FEATURES.map(f => (
                <Reveal key={f.title} className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
                  <div className="font-semibold text-sm mb-2 text-lk-accent">{f.title}</div>
                  <div className="text-xs leading-relaxed text-lk-dim">{f.desc}</div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ── Stats bar ── */}
          <Reveal className="mb-20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Players', value: '15' },
                { label: 'Pool Entry', value: '$10,000' },
                { label: 'Platform Rake', value: '5%' },
                { label: 'Payout Date', value: 'Jun 15 \'26' },
              ].map(s => (
                <div key={s.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-5 text-center">
                  <div className="text-[10px] uppercase tracking-widest text-lk-dim mb-2">{s.label}</div>
                  <div className="text-2xl font-bold text-white">{s.value}</div>
                </div>
              ))}
            </div>
          </Reveal>

          {/* ── CTA ── */}
          <section className="py-20 border-t border-white/5 text-center">
            <h2 className="text-4xl font-black mb-4">Already have access?</h2>
            <p className="text-lk-dim text-sm mb-8">Sign in and start building your portfolio. The pool pays out June 15, 2026.</p>
            <button onClick={onStart} className="landing-glow-btn inline-flex rounded-full bg-lk-accent px-10 py-4 text-sm font-semibold text-black transition hover:brightness-110">
              Sign In
            </button>
          </section>
        </main>

        <footer className="border-t border-white/8 py-8 text-center text-xs text-lk-muted">
          Simulated trading for entertainment purposes only. All cash and pool balances are virtual. Not financial advice.
        </footer>
      </div>
    </div>
  );
}

function Shell() {
  const { user, session, loading: authLoading, signIn, signUp, signOut, forgotPassword } = useAuth();
  const [approvalState, setApprovalState] = useState<'unknown' | 'approved' | 'pending' | 'error'>('unknown');
  const router = useRouter();
  const { players, marketCap, sparklines, loading: pLoading } = usePlayers();
  const { portfolio } = usePortfolio();
  const [tab, setTab] = useState('home');
  const [pid, setPid] = useState<string | null>(null);
  const [view, setView] = useState<'landing' | 'auth'>('landing');
  usePriceTicker();

  useEffect(() => {
    if (!user || !session?.access_token) { setApprovalState('unknown'); return; }
    let active = true;
    const checkApproval = async () => {
      setApprovalState('unknown');
      try {
        const res = await fetch('/api/check-approval', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) { setApprovalState('error'); return; }
        if (data.approved) { setApprovalState('approved'); return; }
        setApprovalState('pending');
        router.push('/pending');
      } catch { if (!active) return; setApprovalState('error'); }
    };
    checkApproval();
    return () => { active = false; };
  }, [user, session?.access_token, router]);

  const selectPlayer = useCallback((p: Player) => { setPid(p.id); setTab('home'); }, []);
  const back = useCallback(() => setPid(null), []);
  const changeTab = useCallback((t: string) => { setTab(t); setPid(null); }, []);
  const openAuth = useCallback(() => setView('auth'), []);
  const backToLanding = useCallback(() => setView('landing'), []);

  if (authLoading) return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center">
      <LakshLogo className="w-12 h-12 mx-auto animate-pulse" />
    </div>
  );

  if (user && approvalState === 'unknown') return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center">
      <LakshLogo className="w-12 h-12 mx-auto animate-pulse" />
    </div>
  );

  if (!user) {
    if (view === 'auth') {
      return (
        <div className="relative min-h-screen bg-lk-bg px-6 py-8 sm:px-10">
          <button onClick={backToLanding} className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10">← Back</button>
          <AuthForm onSignIn={signIn} onSignUp={signUp} onForgotPassword={forgotPassword} />
        </div>
      );
    }
    return <LandingPage onStart={openAuth} />;
  }

  const balance = portfolio?.cash_balance ?? 10000;

  return (
    <div className="min-h-screen bg-lk-bg">
      <Header balance={balance} onSignOut={signOut} />
      <main className="max-w-lg mx-auto pb-24">
        {tab === 'home' && !pid && <HomeView players={players} marketCap={marketCap} sparklines={sparklines} loading={pLoading} onSelect={selectPlayer} />}
        {tab === 'home' && pid && <PlayerDetail playerId={pid} onBack={back} />}
        {tab === 'portfolio' && <PortfolioView onSelect={selectPlayer} />}
        {tab === 'leaderboard' && <LeaderboardView />}
        {tab === 'profile' && <ProfileView onSignOut={signOut} />}
        {tab === 'about' && <AboutView />}
      </main>
      <BottomNav active={tab} onChange={changeTab} />
    </div>
  );
}

export default function Page() { return <AuthProvider><Shell /></AuthProvider>; }
