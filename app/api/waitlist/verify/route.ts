import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

// In-memory rate limit: max 10 verify calls per IP per minute (signup flow needs a few, abuse needs many)
const ipVerifyMap = new Map<string, { count: number; windowStart: number }>();
const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipVerifyMap.get(ip);
  if (!entry || now - entry.windowStart > VERIFY_WINDOW_MS) {
    ipVerifyMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= VERIFY_LIMIT) return true;
  entry.count++;
  return false;
}

function isAdminEmail(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ approved: false, status: 'pending' }, { status: 429 });
  }

  const { email } = await req.json();
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    return NextResponse.json({ approved: false, status: 'invalid' }, { status: 400 });
  }

  if (isAdminEmail(normalizedEmail)) {
    return NextResponse.json({ approved: true, status: 'approved' });
  }

  const db = serverSupa();
  const { data: row, error } = await db
    .from('waitlist')
    .select('status')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (error) {
    console.error('Waitlist verify error:', error);
    return NextResponse.json({ approved: false, status: 'pending' }, { status: 500 });
  }

  if (!row || row.status !== 'approved') {
    return NextResponse.json({ approved: false, status: row?.status || 'pending' });
  }

  return NextResponse.json({ approved: true, status: 'approved' });
}
