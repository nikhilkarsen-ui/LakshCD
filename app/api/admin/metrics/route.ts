import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdmin(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function GET(req: NextRequest) {
  const authUser = await getUser(req);
  if (!authUser?.email || !isAdmin(authUser.email)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 });
  }

  const db = serverSupa();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO   = today.toISOString();
  const week7dISO  = new Date(Date.now() - 7 * 86400000).toISOString();
  const month30ISO = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    poolRes,
    usersRes,
    tradesRes,
    tradesTodayRes,
    tradesWeekRes,
    sessionsRes,
    sessionsTodayRes,
    perUserTradesRes,
    perUserSessionsRes,
    positionsRes,
  ] = await Promise.all([
    // Season pool totals
    db.from('season_pool').select('*').eq('season_key', '2025-26').single(),

    // All approved users
    db.from('users').select('id, email, display_name, balance, created_at, initial_balance')
      .eq('is_approved', true).order('created_at', { ascending: false }),

    // All-time trade stats
    db.from('trades').select('user_id, total_value, fee_charged, side, created_at'),

    // Trades today
    db.from('trades').select('user_id, total_value, fee_charged')
      .gte('created_at', todayISO),

    // Trades last 7 days
    db.from('trades').select('user_id, total_value, fee_charged')
      .gte('created_at', week7dISO),

    // All sessions
    db.from('user_sessions').select('user_id, started_at, ended_at, duration_seconds, page_views, pages_visited'),

    // Sessions started today
    db.from('user_sessions').select('user_id').gte('started_at', todayISO),

    // Per-user trade counts and volume (all time)
    db.from('trades').select('user_id, total_value, fee_charged, created_at'),

    // Per-user session stats
    db.from('user_sessions').select('user_id, started_at, ended_at, duration_seconds, page_views'),

    // Current positions (for portfolio values)
    db.from('positions').select('user_id, shares_owned, player:players(current_price)').gt('shares_owned', 0),
  ]);

  // ── Pool / revenue summary ────────────────────────────────────────────────────
  const pool        = poolRes.data;
  const totalRake   = Number(pool?.rake_collected ?? 0);
  const totalEarlyExit = Number(pool?.early_exit_fees ?? 0);
  const totalDeposited = Number(pool?.total_deposited ?? 0);
  const totalWithdrawn = Number(pool?.total_withdrawn ?? 0);
  const distributionPool = Number(pool?.distribution_pool ?? 0);

  const allTrades   = tradesRes.data ?? [];
  const totalTxFees = allTrades.reduce((s: number, t: any) => s + Number(t.fee_charged ?? 0), 0);
  const totalRevenue = totalRake + totalTxFees + totalEarlyExit;

  const totalTradeCount  = allTrades.length;
  const totalTradeVolume = allTrades.reduce((s: number, t: any) => s + Number(t.total_value ?? 0), 0);

  const tradesToday      = (tradesTodayRes.data ?? []).length;
  const volumeToday      = (tradesTodayRes.data ?? []).reduce((s: number, t: any) => s + Number(t.total_value ?? 0), 0);
  const feesToday        = (tradesTodayRes.data ?? []).reduce((s: number, t: any) => s + Number(t.fee_charged ?? 0), 0);
  const tradesThisWeek   = (tradesWeekRes.data ?? []).length;

  // ── Session summary ───────────────────────────────────────────────────────────
  const allSessions      = sessionsRes.data ?? [];
  const totalSessions    = allSessions.length;
  const sessionsToday    = (sessionsTodayRes.data ?? []).length;
  const dauToday         = new Set((sessionsTodayRes.data ?? []).map((s: any) => s.user_id)).size;

  const completedSessions = allSessions.filter((s: any) => s.duration_seconds != null);
  const avgSessionSec = completedSessions.length > 0
    ? completedSessions.reduce((s: number, sess: any) => s + Number(sess.duration_seconds), 0) / completedSessions.length
    : 0;

  // ── Users ─────────────────────────────────────────────────────────────────────
  const users = usersRes.data ?? [];

  // Portfolio value per user: cash + mark-to-market positions
  const positions = positionsRes.data ?? [];
  const portfolioByUser: Record<string, number> = {};
  for (const u of users) portfolioByUser[u.id] = Number(u.balance ?? 0);
  for (const pos of positions) {
    const price = Number((pos as any).player?.current_price ?? 0);
    const val   = Number(pos.shares_owned) * price;
    if (portfolioByUser[pos.user_id] !== undefined) portfolioByUser[pos.user_id] += val;
  }

  // Trades per user
  const tradesByUser: Record<string, { count: number; volume: number; fees: number; lastTrade: string | null; tradesToday: number }> = {};
  for (const u of users) tradesByUser[u.id] = { count: 0, volume: 0, fees: 0, lastTrade: null, tradesToday: 0 };
  for (const t of (perUserTradesRes.data ?? []) as any[]) {
    if (!tradesByUser[t.user_id]) continue;
    tradesByUser[t.user_id].count++;
    tradesByUser[t.user_id].volume += Number(t.total_value ?? 0);
    tradesByUser[t.user_id].fees   += Number(t.fee_charged ?? 0);
    if (!tradesByUser[t.user_id].lastTrade || t.created_at > tradesByUser[t.user_id].lastTrade!) {
      tradesByUser[t.user_id].lastTrade = t.created_at;
    }
    if (t.created_at >= todayISO) tradesByUser[t.user_id].tradesToday++;
  }

  // Sessions per user
  const sessionsByUser: Record<string, { count: number; totalSeconds: number; pageViews: number; lastSeen: string | null }> = {};
  for (const u of users) sessionsByUser[u.id] = { count: 0, totalSeconds: 0, pageViews: 0, lastSeen: null };
  for (const s of (perUserSessionsRes.data ?? []) as any[]) {
    if (!sessionsByUser[s.user_id]) continue;
    sessionsByUser[s.user_id].count++;
    sessionsByUser[s.user_id].totalSeconds += Number(s.duration_seconds ?? 0);
    sessionsByUser[s.user_id].pageViews    += Number(s.page_views ?? 0);
    const seenAt = s.ended_at ?? s.started_at;
    if (!sessionsByUser[s.user_id].lastSeen || seenAt > sessionsByUser[s.user_id].lastSeen!) {
      sessionsByUser[s.user_id].lastSeen = seenAt;
    }
  }

  // Days since joined (for trades-per-day)
  const userTable = users.map((u: any) => {
    const daysSinceJoined = Math.max(1, (Date.now() - new Date(u.created_at).getTime()) / 86400000);
    const tbu = tradesByUser[u.id] ?? { count: 0, volume: 0, fees: 0, lastTrade: null, tradesToday: 0 };
    const sbu = sessionsByUser[u.id] ?? { count: 0, totalSeconds: 0, pageViews: 0, lastSeen: null };
    const lastActive = [tbu.lastTrade, sbu.lastSeen].filter(Boolean).sort().pop() ?? null;
    return {
      id:              u.id,
      email:           u.email,
      display_name:    u.display_name ?? null,
      joined:          u.created_at,
      portfolio_value: parseFloat((portfolioByUser[u.id] ?? Number(u.balance)).toFixed(2)),
      initial_balance: Number(u.initial_balance ?? 10000),
      pnl:             parseFloat(((portfolioByUser[u.id] ?? Number(u.balance)) - Number(u.initial_balance ?? 10000)).toFixed(2)),
      total_trades:    tbu.count,
      trades_today:    tbu.tradesToday,
      trades_per_day:  parseFloat((tbu.count / daysSinceJoined).toFixed(2)),
      total_volume:    parseFloat(tbu.volume.toFixed(2)),
      total_fees_paid: parseFloat(tbu.fees.toFixed(2)),
      total_sessions:  sbu.count,
      total_page_views:sbu.pageViews,
      time_spent_min:  parseFloat((sbu.totalSeconds / 60).toFixed(1)),
      last_active:     lastActive,
    };
  });

  return NextResponse.json({
    // Revenue
    revenue: {
      total:       parseFloat(totalRevenue.toFixed(2)),
      rake:        parseFloat(totalRake.toFixed(2)),
      tx_fees:     parseFloat(totalTxFees.toFixed(2)),
      early_exit:  parseFloat(totalEarlyExit.toFixed(2)),
    },
    // Pool
    pool: {
      total_deposited:   parseFloat(totalDeposited.toFixed(2)),
      distribution_pool: parseFloat(distributionPool.toFixed(2)),
      total_withdrawn:   parseFloat(totalWithdrawn.toFixed(2)),
    },
    // Trading activity
    trading: {
      total_trades:     totalTradeCount,
      total_volume:     parseFloat(totalTradeVolume.toFixed(2)),
      trades_today:     tradesToday,
      volume_today:     parseFloat(volumeToday.toFixed(2)),
      fees_today:       parseFloat(feesToday.toFixed(2)),
      trades_this_week: tradesThisWeek,
    },
    // Engagement
    engagement: {
      total_users:      users.length,
      total_sessions:   totalSessions,
      sessions_today:   sessionsToday,
      dau:              dauToday,
      avg_session_min:  parseFloat((avgSessionSec / 60).toFixed(1)),
    },
    // Per-user table
    users: userTable,
    generated_at: new Date().toISOString(),
  });
}
