// ============================================================
// GET  /api/stats/sync  — called by Vercel cron (GET)
// POST /api/stats/sync  — called manually with Bearer token
//
// Auth:
//   GET  — Vercel automatically adds x-vercel-cron:1 to cron requests
//   POST — requires valid user Bearer token
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { syncStats } from '@/lib/stats';
import { syncInjuries } from '@/lib/injury-sync';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle() {
  try {
    const [statsResult, injuryResult] = await Promise.all([
      syncStats(),
      syncInjuries(),
    ]);
    return NextResponse.json({
      success: true,
      stats: {
        updated: statsResult.updated,
        mapped:  statsResult.mapped,
        skipped: statsResult.skipped,
        errors:  statsResult.errors,
      },
      injuries: {
        injured: injuryResult.injured,
        cleared: injuryResult.cleared,
        total:   injuryResult.total,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Stats sync error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Vercel cron jobs send GET with x-vercel-cron:1 header — verify it or fall back to user auth
export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const cronSecret   = req.headers.get('x-cron-secret');
  const validCron    = isVercelCron || (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!validCron) {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return handle();
}

// Manual trigger via Bearer token (browser console, curl, etc.)
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handle();
}
