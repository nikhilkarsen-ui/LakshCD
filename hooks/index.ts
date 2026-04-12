'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from 'react';
import { browserSupa } from '@/lib/supabase';
import { Player, Trade, LeaderboardEntry, PricePoint, ChartRange, PortfolioData } from '@/types';
import { POLL } from '@/config/constants';
import type { Session, User } from '@supabase/supabase-js';

// --- Auth Context ---
interface AuthCtx { user: User | null; session: Session | null; loading: boolean; signUp: (e: string, p: string, n: string) => Promise<any>; signIn: (e: string, p: string) => Promise<any>; signOut: () => Promise<void>; forgotPassword: (e: string) => Promise<any>; }
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const sb = useMemo(() => {
    try { return browserSupa(); } catch { console.warn('Supabase client not available during build time'); return null; }
  }, []);
  const created = useRef(false);

  useEffect(() => {
    if (!sb) { setLoading(false); return; }
    sb.auth.getSession().then(({ data: { session: s } }) => { setSession(s); setUser(s?.user ?? null); setLoading(false); });
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (ev, s) => {
      if (ev === 'TOKEN_REFRESHED' && !s) { setUser(null); setSession(null); setLoading(false); return; }
      setSession(s); setUser(s?.user ?? null); setLoading(false);
      if (ev === 'SIGNED_IN' && s?.user && !created.current) {
        created.current = true;
        await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
          body: JSON.stringify({ user_id: s.user.id, email: s.user.email, display_name: s.user.user_metadata?.display_name || s.user.email?.split('@')[0] }),
        }).catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, [sb]);

  const checkApproval = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/check-approval', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { approved: false, status: 'pending' };
      return await res.json();
    } catch { return { approved: false, status: 'pending' }; }
  }, []);

  const checkWaitlistApproval = useCallback(async (email: string) => {
    try {
      const res = await fetch('/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return await res.json();
    } catch {
      return { approved: false, status: 'pending' };
    }
  }, []);

  const signUp = useCallback(async (e: string, p: string, n: string) => {
    if (!sb) throw new Error('Supabase client not available');
    const approval = await checkWaitlistApproval(e);
    if (!approval.approved) {
      return { error: new Error('You are not approved yet for the beta.') } as any;
    }

    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/`
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    return await sb.auth.signUp({ email: e, password: p, options: { data: { display_name: n }, emailRedirectTo: redirectTo } });
  }, [sb, checkWaitlistApproval]);

  const signIn = useCallback(async (e: string, p: string) => {
    if (!sb) throw new Error('Supabase client not available');
    const response = await sb.auth.signInWithPassword({ email: e, password: p });
    if (response.error || !response.data.session?.access_token) return response;
    const approval = await checkApproval(response.data.session.access_token);
    if (!approval.approved) {
      await sb.auth.signOut();
      setUser(null);
      setSession(null);
      return { error: new Error('Your account is not approved for the beta yet.') } as any;
    }
    return response;
  }, [sb, checkApproval]);

  const signOut = useCallback(async () => {
    if (!sb) return;
    created.current = false;
    await sb.auth.signOut();
    setUser(null); setSession(null);
  }, [sb]);

  const forgotPassword = useCallback(async (e: string) => {
    if (!sb) throw new Error('Supabase client not available');
    // Check account exists before triggering reset — avoids leaking "sent" confirmation
    // to people probing for valid emails, and gives a clear UX message.
    const res = await fetch('/api/auth/check-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e }),
    });
    if (res.ok) {
      const { exists } = await res.json();
      if (!exists) return { error: new Error('No account found with that email address.') };
    }
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
      ?? (typeof window !== 'undefined' ? window.location.origin : '');
    const redirectTo = base ? `${base}/reset-password` : undefined;
    return await sb.auth.resetPasswordForEmail(e, { redirectTo });
  }, [sb]);

  const val = useMemo(() => ({ user, session, loading, signUp, signIn, signOut, forgotPassword }), [user, session, loading, signUp, signIn, signOut, forgotPassword]);
  return React.createElement(Ctx.Provider, { value: val }, children);
}
export function useAuth() { const c = useContext(Ctx); if (!c) throw new Error('Wrap in AuthProvider'); return c; }

// --- Helper: auth fetch ---
function useTokenRef() {
  const { session } = useAuth();
  const ref = useRef<string | null>(null);
  useEffect(() => { ref.current = session?.access_token ?? null; }, [session?.access_token]);
  return ref;
}

// --- Players ---
export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [marketCap, setMarketCap] = useState<number>(0);
  const [sparklines, setSparklines] = useState<Record<string, { price: number }[]>>({});
  const [loading, setLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch('/api/players');
      if (!r.ok) { console.error(`Players API error: ${r.status} ${r.statusText}`); setLoading(false); return; }
      const d = await r.json();
      setPlayers(d.players || []);
      setMarketCap(d.market_cap ?? 0);
      setSparklines(d.sparklines ?? {});
    } catch (error) { console.error('Failed to fetch players:', error); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetch_(); const i = setInterval(fetch_, POLL.prices); return () => clearInterval(i); }, [fetch_]);
  return { players, marketCap, sparklines, loading, refetch: fetch_ };
}

// --- Player Detail ---
export function usePlayerDetail(id: string | null, range: ChartRange = '24H') {
  const [player, setPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const fetch_ = useCallback(async () => {
    if (!id) return;
    const rid = ++reqId.current; setLoading(true);
    try {
      const r = await fetch(`/api/players/${id}?range=${range}`);
      if (rid !== reqId.current) return;
      const d = await r.json(); setPlayer(d.player); setHistory(d.price_history || []);
    } catch {} finally { if (rid === reqId.current) setLoading(false); }
  }, [id, range]);
  useEffect(() => { fetch_(); const i = setInterval(fetch_, POLL.portfolio); return () => clearInterval(i); }, [fetch_]);
  useEffect(() => { if (!id) { setPlayer(null); setHistory([]); } }, [id]);
  return { player, priceHistory: history, loading, refetch: fetch_ };
}

// --- Portfolio ---
export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const { session } = useAuth();
  const tokenRef = useTokenRef();

  const fetch_ = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) { setLoading(false); return; }
    try {
      const r = await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { console.error('Portfolio fetch failed:', r.status); setLoading(false); return; }
      const d = await r.json();
      setPortfolio(d.portfolio);
      setUserProfile(d.user);
      setTrades(d.trades || []);
    } catch (e) { console.error('Portfolio fetch error:', e); }
    finally { setLoading(false); }
  }, [tokenRef]);

  useEffect(() => {
    if (!session?.access_token) { setLoading(false); return; }
    const t = setTimeout(() => { fetch_(); }, 100);
    const i = setInterval(fetch_, POLL.portfolio);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [session?.access_token, fetch_]);

  return { portfolio, userProfile, trades, loading, refetch: fetch_ };
}

// --- Leaderboard ---
export function useLeaderboard() {
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    try { const r = await fetch('/api/leaderboard'); const d = await r.json(); setBoard(d.leaderboard || []); setTotal(d.total_traders || 0); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { fetch_(); const i = setInterval(fetch_, POLL.leaderboard); return () => clearInterval(i); }, [fetch_]);
  return { leaderboard: board, totalTraders: total, loading };
}

// --- Trade executor ---
export function useTrade() {
  const [executing, setExecuting] = useState(false);
  const tokenRef = useTokenRef();
  const exec = useCallback(async (playerId: string, dollars: number, side: 'buy' | 'sell', sellAll = false) => {
    const token = tokenRef.current;
    if (!token) return { success: false, error: 'Not authenticated' };
    setExecuting(true);
    try {
      const r = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ player_id: playerId, dollars, side, sell_all: sellAll }),
      });
      const d = await r.json();
      if (!r.ok) return { success: false, error: d.error };
      return d;
    } catch (e: any) { return { success: false, error: e.message }; }
    finally { setExecuting(false); }
  }, [tokenRef]);
  return { execute: exec, executing };
}

// --- Price ticker ---
// Fires the server-side tick from the active browser tab.
// Only runs when the tab is visible to avoid background tabs piling on.
export function usePriceTicker() {
  const tokenRef = useTokenRef();
  useEffect(() => {
    const fire = async () => {
      const token = tokenRef.current;
      if (!token) return;
      try {
        await fetch('/api/prices/tick', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {}
    };
    const d = setTimeout(fire, 2000);
    const i = setInterval(fire, POLL.prices);
    return () => { clearTimeout(d); clearInterval(i); };
  }, [tokenRef]);
}

// --- Countdown (kept for any components that still use it) ---
export function useCountdown(target: string) {
  const [s, setS] = useState('');
  useEffect(() => {
    const t = new Date(target).getTime();
    const u = () => {
      const d = t - Date.now();
      if (d <= 0) { setS('SETTLED'); return; }
      setS(`${Math.floor(d/864e5)}d ${Math.floor(d%864e5/36e5)}h ${Math.floor(d%36e5/6e4)}m ${Math.floor(d%6e4/1e3)}s`);
    };
    u(); const i = setInterval(u, 1000); return () => clearInterval(i);
  }, [target]);
  return s;
}
