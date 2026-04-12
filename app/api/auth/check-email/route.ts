import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

// In-memory rate limit: max 5 checks per IP per minute
const ipMap = new Map<string, { count: number; windowStart: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now - entry.windowStart > 60_000) { ipMap.set(ip, { count: 1, windowStart: now }); return false; }
  if (entry.count >= 5) return true;
  entry.count++;
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (isRateLimited(ip)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return NextResponse.json({ exists: false });

  const db = serverSupa();
  const { data } = await db
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  // Always return 200 — vary only the `exists` field so timing attacks are harder
  return NextResponse.json({ exists: !!data });
}
