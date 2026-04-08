// ============================================================
// POST /api/stats/sync
//
// Fetches live NBA season averages from BallDontLie and writes
// ppg, apg, rpg, efficiency, games_played into the players table.
// The pricing engine's computeEV() reads those fields directly,
// so the next price tick immediately uses real stats.
//
// Auth: x-cron-secret header (Vercel cron) OR user Bearer token.
// Called daily by vercel.json cron schedule.
//
// Two-phase behavior:
//   1. Players without bdl_player_id get a name-search lookup
//      (one-time per player, rate-limited by BDL_SEARCH_DELAY_MS).
//   2. All players with known IDs get a single batched stats fetch.
//
// Returns: { success, updated, mapped, skipped, errors, timestamp }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { syncStats } from '@/lib/stats';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds — needed for initial ID-mapping phase

export async function POST(req: NextRequest) {
  // Auth: cron secret or valid user JWT
  const cronSecret = req.headers.get('x-cron-secret');
  const validCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  if (!validCron) {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await syncStats();
    return NextResponse.json({
      success: true,
      updated: result.updated,
      mapped: result.mapped,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Stats sync error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
