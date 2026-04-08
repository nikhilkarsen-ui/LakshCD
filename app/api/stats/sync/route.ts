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
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle() {
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

// Vercel cron jobs send GET — accept x-vercel-cron header as proof of origin
export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handle();
}

// Manual trigger via Bearer token (browser console, curl, etc.)
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handle();
}
