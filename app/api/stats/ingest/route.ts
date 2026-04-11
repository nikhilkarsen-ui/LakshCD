// ============================================================
// GET  /api/stats/ingest  — Vercel cron (runs every minute)
// POST /api/stats/ingest  — manual trigger (x-cron-secret or user JWT)
//
// The ONLY route that calls the BallDontLie API.
// Delegates entirely to bdl-poller.ts which:
//   - Checks game_schedule_cache (refreshes at most once/hour)
//   - Skips all BDL calls when no games are in progress
//   - Tries /live_box_scores (paid tier), falls back to /stats
//   - Writes results to live_stat_cache
//   - Tracks every request in bdl_poll_log for rate-limit enforcement
//
// Max BDL usage: 2 req/cron during live games (≈3.3% of 60/min budget).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUser, getAppUser } from '@/lib/auth';
import { runPoll } from '@/lib/bdl-poller';
import { syncLiveBoosts } from '@/lib/live-stats';
import { syncInjuries } from '@/lib/injury-sync';
import { serverSupa } from '@/lib/supabase';
export const dynamic    = 'force-dynamic';
export const maxDuration = 30;

const INJURY_SYNC_INTERVAL_MS = 60 * 60 * 1000; // re-fetch BDL /injuries at most once/hour

async function maybesyncInjuries() {
  const db = serverSupa();
  const { data } = await db
    .from('game_schedule_cache')
    .select('fetched_at')
    .eq('date_key', '_injury_sync')
    .single();

  const lastSync = data?.fetched_at ? new Date(data.fetched_at).getTime() : 0;
  if (Date.now() - lastSync < INJURY_SYNC_INTERVAL_MS) return null;

  const result = await syncInjuries();

  await db.from('game_schedule_cache').upsert(
    { date_key: '_injury_sync', has_live_games: false, games: [], fetched_at: new Date().toISOString() },
    { onConflict: 'date_key' },
  );

  return result;
}

async function handle() {
  try {
    // Step 1: Poll BDL (0–2 API calls, game-schedule-aware)
    const poll = await runPoll();

    // Step 2: Apply stat-delta price bumps from the freshly written cache.
    let sync = null;
    if (poll.action === 'live' || poll.action === 'final') {
      sync = await syncLiveBoosts();
    }

    // Step 3: Hourly injury sync (throttled — at most 1 BDL call/hour)
    const injuries = await maybesyncInjuries().catch(() => null);

    return NextResponse.json({
      success:   true,
      poll:      { action: poll.action, apiCalls: poll.apiCalls, written: poll.written, message: poll.message },
      sync:      sync ? { updated: sync.updated, boosted: sync.boosted, reset: sync.reset } : null,
      injuries:  injuries ? { injured: injuries.injured, cleared: injuries.cleared } : null,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('BDL ingest error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function checkAuth(req: NextRequest): Promise<boolean> {
  const cronSecret   = req.headers.get('x-cron-secret');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron || (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET)) return true;
  const appUser = await getAppUser(req);
  return !!appUser?.is_approved;
}

export async function GET(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handle();
}

export async function POST(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handle();
}
