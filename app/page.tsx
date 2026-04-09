'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth, usePlayers, usePriceTicker, usePortfolio, useCountdown } from '@/hooks';
import { Player } from '@/types';
import AuthForm from '@/components/AuthForm';
import WaitlistForm from '@/components/WaitlistForm';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import HomeView from '@/components/HomeView';
import PlayerDetail from '@/components/PlayerDetail';
import PortfolioView from '@/components/PortfolioView';
import LeaderboardView from '@/components/LeaderboardView';
import ProfileView from '@/components/ProfileView';
import AboutView from '@/components/AboutView';

const HERO_FEATURES = [
  { title: 'AMM Pricing', description: 'Token prices move with every trade through an automated market maker.' },
  { title: 'Long & Short', description: 'Buy to go long or sell to open a short position with the same interface.' },
  { title: '50% Margin', description: 'Only half of the trade value is held as initial margin on every position.' },
  { title: 'Real-Time P&L', description: 'Track unrealized returns, margin health, and liquidation thresholds live.' },
  { title: 'Leaderboard', description: 'Rank users by portfolio return and see top traders climb the board.' },
  { title: 'Stat-Driven EV', description: 'Prices react to PPG, APG, efficiency, and simulated game momentum.' },
];

const TICKER_SYMBOLS = ['LAL', 'BKN', 'GSW', 'MIL', 'BOS', 'PHX', 'MIA', 'OKC'];

function useScrollReveal() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
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
  const countdown = useCountdown('2026-06-15T00:00:00Z');

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const tickerItems = useMemo(() => {
    if (!players?.length) {
      return TICKER_SYMBOLS.map((symbol, idx) => ({ symbol, price: 18.5 + idx * 1.2, change: idx % 2 === 0 ? 0.9 : -0.6 }));
    }
    return players.slice(0, 6).map(player => ({ symbol: player.team, price: player.current_price, change: player.price_change_pct_24h }));
  }, [players]);

  return (
    <div className="relative overflow-hidden min-h-screen bg-lk-bg text-white">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 landing-grid" />
        <div className="absolute inset-0 landing-glow" />
        <div className="absolute inset-0 landing-noise" />
      </div>

      <div className="relative z-10">
        <header className={`sticky top-0 z-30 transition duration-300 ${navScrolled ? 'backdrop-blur-xl bg-black/30 border-b border-white/10 shadow-black/20' : 'bg-transparent'} `}>
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-lk-accent to-emerald-500 text-black font-bold">L</div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-lk-accent/90">Laksh</p>
                <p className="text-xs text-lk-dim">The 24/7 Sports Exchange</p>
              </div>
            </div>
            <button onClick={onStart} className="rounded-full bg-lk-accent px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110">Start Trading</button>
          </div>
        </header>

        <section className="border-t border-white/5 bg-black/5">
          <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-hidden px-6 py-3 text-sm text-lk-text">
            <div className="flex min-w-max items-center gap-3">
              <span className="rounded-full bg-lk-accent/10 px-3 py-1 text-lk-accent">Live Ticker</span>
              <span>Prices update every 5s.</span>
            </div>
            <div className="relative flex h-8 min-w-[14rem] overflow-hidden rounded-full bg-white/5 px-2">
              <div className="landing-ticker flex min-w-full gap-4 whitespace-nowrap text-xs font-medium text-lk-text">
                {tickerItems.concat(tickerItems).map((item, index) => (
                  <div key={`${item.symbol}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    <span className="font-semibold">{item.symbol}</span>
                    <span>${item.price.toFixed(2)}</span>
                    <span className={`${item.change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <main className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-lk-accent/20 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-lk-accent shadow-lg shadow-lk-accent/5">Season settlement: June 15, 2026</div>
              <div className="space-y-6">
                <p className="text-sm uppercase tracking-[0.4em] text-emerald-300/90">Fantasy tokenized trading</p>
                <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">Trade the <span className="bg-gradient-to-r from-emerald-300 via-cyan-200 to-sky-400 bg-clip-text text-transparent">future of sports</span></h1>
                <p className="max-w-2xl text-lg leading-8 text-lk-dim">Speculate on NBA player performance with a simulated exchange. Buy long or sell short, manage 50% margin, and monitor unrealized P&L, liquidation risk and leaderboard momentum in real time.</p>
              </div>

              <div className="flex flex-wrap gap-4">
                <button onClick={onStart} className="rounded-full bg-lk-accent px-7 py-3 text-sm font-semibold text-black transition hover:brightness-110">Create Your Account</button>
                <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-full border border-white/10 bg-white/5 px-7 py-3 text-sm text-white transition hover:bg-white/10">Explore Player Prices</button>
              </div>

              <div className="mt-8 rounded-3xl border border-white/10 bg-black/40 p-6 shadow-xl shadow-black/10">
                <p className="text-sm uppercase tracking-[0.35em] text-lk-accent">Join the beta waitlist</p>
                <p className="mt-3 text-sm text-lk-text">Submit your email and we’ll email you when beta spots open.</p>
                <WaitlistForm />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <p className="text-sm uppercase tracking-[0.3em] text-lk-dim">Margin</p>
                  <p className="mt-3 text-3xl font-semibold text-white">50%</p>
                  <p className="mt-2 text-sm text-lk-muted">Half of the position value is held as initial margin.</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <p className="text-sm uppercase tracking-[0.3em] text-lk-dim">Updates</p>
                  <p className="mt-3 text-3xl font-semibold text-white">Every 5s</p>
                  <p className="mt-2 text-sm text-lk-muted">Prices refresh automatically with live performance data.</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="landing-hero-card relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-lk-accent/15">
                <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="relative z-10 space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-lk-dim">Mock player</p>
                      <h2 className="mt-2 text-xl font-semibold">Ja Morant</h2>
                    </div>
                    <div className="rounded-2xl bg-black/50 px-3 py-2 text-xs text-lk-text">PG · MEM</div>
                  </div>

                  <div className="rounded-3xl bg-black/40 p-5 text-white shadow-lg shadow-black/10">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-lk-dim">Token Price</p>
                        <p className="mt-3 text-3xl font-semibold">$42.38</p>
                      </div>
                      <div className="rounded-3xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300">+4.6%</div>
                    </div>
                    <div className="mt-6 h-40 overflow-hidden rounded-[1.5rem] bg-gradient-to-b from-emerald-500/10 to-transparent">
                      <svg viewBox="0 0 240 120" className="h-full w-full">
                        <path d="M0 96 C40 77 80 62 120 72 C160 82 200 44 240 36" fill="none" stroke="url(#heroChart)" strokeWidth="4" strokeLinecap="round" />
                        <defs>
                          <linearGradient id="heroChart" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#34d399" />
                            <stop offset="100%" stopColor="#06b6d4" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-3xl bg-black/40 p-4 text-xs text-lk-dim">
                      <p>PPG</p>
                      <p className="mt-2 text-sm text-white">28.4</p>
                    </div>
                    <div className="rounded-3xl bg-black/40 p-4 text-xs text-lk-dim">
                      <p>APG</p>
                      <p className="mt-2 text-sm text-white">8.7</p>
                    </div>
                    <div className="rounded-3xl bg-black/40 p-4 text-xs text-lk-dim">
                      <p>Efficiency</p>
                      <p className="mt-2 text-sm text-white">27.1</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section id="features" className="mt-24">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm uppercase tracking-[0.4em] text-lk-accent/90">How Laksh works</p>
              <h2 className="mt-4 text-4xl font-bold text-white">A sports trading platform built for momentum and risk control.</h2>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {HERO_FEATURES.map(feature => (
                <Reveal key={feature.title} className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-xl shadow-black/10">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-lk-accent">{feature.title}</p>
                  <p className="mt-4 text-sm leading-6 text-lk-text">{feature.description}</p>
                </Reveal>
              ))}
            </div>
          </section>

          <section className="mt-24 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/10">
              <p className="text-sm uppercase tracking-[0.35em] text-lk-accent">How it works</p>
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                {[
                  { step: '1', title: 'Choose athletes', desc: 'Browse NBA player tokens and price curves powered by AMM supply/demand.' },
                  { step: '2', title: 'Stake virtual dollars', desc: 'Open long or short positions with 50% initial margin.' },
                  { step: '3', title: 'Monitor health', desc: 'Track P&L, margin usage, and liquidation levels instantly.' },
                  { step: '4', title: 'Settle season', desc: 'Positions settle on the season expiry date to lock results.' },
                ].map(item => (
                  <div key={item.step} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/5 text-lg font-semibold text-white">{item.step}</div>
                    <p className="mt-4 font-semibold text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-lk-muted">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-emerald-500/20 bg-emerald-500/5 p-8 shadow-[0_30px_80px_-45px_rgba(16,185,129,0.35)]">
              <p className="text-sm uppercase tracking-[0.35em] text-emerald-200">Settlement date</p>
              <h3 className="mt-4 text-3xl font-semibold text-white">June 15, 2026</h3>
              <p className="mt-4 text-sm leading-6 text-lk-dim">The season expiry date defines a hard endpoint for all open trade positions and final portfolio settlement.</p>
              <div className="mt-8 rounded-3xl bg-black/20 px-5 py-4">
                <p className="text-xs uppercase tracking-[0.35em] text-lk-dim">Countdown to settlement</p>
                <p className="mt-3 text-2xl font-semibold text-white">{countdown}</p>
              </div>
            </div>
          </section>

          <section className="mt-24">
            <div className="grid gap-4 sm:grid-cols-4">
              {[
                { label: 'Players', value: '15' },
                { label: 'Starting', value: '$10K' },
                { label: 'Margin', value: '50%' },
                { label: 'Updates', value: '5s' },
              ].map(item => (
                <div key={item.label} className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
                  <p className="text-sm uppercase tracking-[0.3em] text-lk-dim">{item.label}</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-24 rounded-[2rem] border border-white/10 bg-white/5 p-12 text-center shadow-2xl shadow-black/20">
            <p className="text-sm uppercase tracking-[0.35em] text-lk-accent">Ready to trade?</p>
            <h2 className="mt-5 text-4xl font-black leading-tight text-white">Launch your mock season with emergent NBA price discovery.</h2>
            <button onClick={onStart} className="landing-glow-btn mt-10 inline-flex rounded-full bg-lk-accent px-9 py-4 text-sm font-semibold text-black transition hover:brightness-110">Start Trading</button>
          </section>
        </main>

        <footer className="border-t border-white/10 bg-black/5 py-8 text-center text-xs text-lk-muted">
          Simulated positions are for educational and entertainment purposes only. Not financial advice.
        </footer>
      </div>
    </div>
  );
}

function Shell() {
  const { user, session, loading: authLoading, signIn, signUp, signOut } = useAuth();
  const [approvalState, setApprovalState] = useState<'unknown' | 'approved' | 'pending' | 'error'>('unknown');
  const router = useRouter();
  const { players, openInterest, loading: pLoading } = usePlayers();
  const { portfolio } = usePortfolio();
  const [tab, setTab] = useState('home');
  const [pid, setPid] = useState<string | null>(null);
  const [view, setView] = useState<'landing' | 'auth'>('landing');
  usePriceTicker();

  useEffect(() => {
    if (!user || !session?.access_token) {
      setApprovalState('unknown');
      return;
    }

    let active = true;
    const checkApproval = async () => {
      setApprovalState('unknown');

      try {
        const res = await fetch('/api/check-approval', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();

        if (!active) return;
        if (!res.ok) {
          setApprovalState('error');
          return;
        }

        if (data.approved) {
          setApprovalState('approved');
          return;
        }

        setApprovalState('pending');
        router.push('/pending');
      } catch (error) {
        if (!active) return;
        setApprovalState('error');
      }
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
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center mx-auto animate-pulse text-lk-bg font-extrabold text-lg">L</div>
    </div>
  );

  if (user && approvalState === 'unknown') return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center mx-auto animate-pulse text-lk-bg font-extrabold text-lg">L</div>
    </div>
  );

  if (!user) {
    if (view === 'auth') {
      return (
        <div className="relative min-h-screen bg-lk-bg px-6 py-8 sm:px-10">
          <button onClick={backToLanding} className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10">← Back</button>
          <AuthForm onSignIn={signIn} onSignUp={signUp} />
        </div>
      );
    }
    return <LandingPage onStart={openAuth} />;
  }

  const balance = portfolio?.cash_balance ?? 10000;

  return (
    <div className="min-h-screen bg-lk-bg">
      <Header balance={balance} onSignOut={signOut}/>
      <main className="max-w-lg mx-auto pb-24">
        {tab === 'home' && !pid && <HomeView players={players} openInterest={openInterest} loading={pLoading} onSelect={selectPlayer}/>}
        {tab === 'home' && pid && <PlayerDetail playerId={pid} onBack={back}/>}
        {tab === 'portfolio' && <PortfolioView onSelect={selectPlayer}/>}
        {tab === 'leaderboard' && <LeaderboardView/>}
        {tab === 'profile' && <ProfileView onSignOut={signOut}/>}
        {tab === 'about' && <AboutView/>}
      </main>
      <BottomNav active={tab} onChange={changeTab}/>
    </div>
  );
}

export default function Page() { return <AuthProvider><Shell/></AuthProvider>; }
