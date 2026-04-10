// ============================================================
// GET  /api/stats/live  — Vercel cron (runs every 5 min during game hours)
// POST /api/stats/live  — manual trigger with Bearer token
//
// Updates live_game_boost for each player based on today's
// BallDontLie box scores. Safe to call repeatedly.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { syncLiveBoosts } from '@/lib/live-stats';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function handle() {
  try {
    const result = await syncLiveBoosts();
    return NextResponse.json({
      success: true,
      boosted: result.boosted,
      reset: result.reset,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Live stats sync error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return handle();
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handle();
}
