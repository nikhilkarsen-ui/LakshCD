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
import { getUser } from '@/lib/auth';
import { runPoll } from '@/lib/bdl-poller';
import { syncLiveBoosts } from '@/lib/live-stats';
export const dynamic    = 'force-dynamic';
export const maxDuration = 30;

async function handle() {
  try {
    // Step 1: Poll BDL (0–2 API calls, game-schedule-aware)
    const poll = await runPoll();

    // Step 2: Apply stat-delta price bumps from the freshly written cache.
    // Only run when games are in progress or just finished — skip otherwise
    // to avoid unnecessary DB work on off-days.
    let sync = null;
    if (poll.action === 'live' || poll.action === 'final') {
      sync = await syncLiveBoosts();
    }

    return NextResponse.json({
      success:   true,
      poll:      { action: poll.action, apiCalls: poll.apiCalls, written: poll.written, message: poll.message },
      sync:      sync ? { updated: sync.updated, boosted: sync.boosted, reset: sync.reset } : null,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('BDL ingest error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const cronSecret  = req.headers.get('x-cron-secret');
  const validCron   = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  if (!validCron) {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return handle();
}

export async function POST(req: NextRequest) {
  const cronSecret  = req.headers.get('x-cron-secret');
  const validCron   = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  if (!validCron) {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return handle();
}
