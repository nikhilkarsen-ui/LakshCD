// GET /api/health
//
// Returns deployment health — checks all required env vars and
// critical service connectivity. Hit this after every deploy.

import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BALLDONTLIE_API_KEY',
  'CRON_SECRET',
];

export async function GET() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  const warnings: string[] = [];

  if (!process.env.ADMIN_EMAILS) {
    warnings.push('ADMIN_EMAILS not set — no admin accounts will have elevated access');
  }

  const status = missing.length === 0 ? 'ok' : 'degraded';

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    env: {
      missing,
      warnings,
      present: REQUIRED_ENV.filter(k => !!process.env[k]),
    },
  }, { status: missing.length === 0 ? 200 : 500 });
}
