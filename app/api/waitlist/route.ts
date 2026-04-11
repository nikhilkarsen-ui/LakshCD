import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { sendWaitlistConfirmation, sendAdminWaitlistNotification } from '@/lib/email';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In-memory rate limit: max 3 waitlist joins per IP per 10 minutes
const ipJoinMap = new Map<string, { count: number; windowStart: number }>();
const JOIN_LIMIT = 3;
const JOIN_WINDOW_MS = 10 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipJoinMap.get(ip);
  if (!entry || now - entry.windowStart > JOIN_WINDOW_MS) {
    ipJoinMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= JOIN_LIMIT) return true;
  entry.count++;
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const body = await req.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const db = serverSupa();

  const { data: existing, error: existingError } = await db
    .from('waitlist')
    .select('id,status')
    .eq('email', email)
    .maybeSingle();

  if (existingError) {
    console.error('Waitlist lookup failed:', existingError);
    return NextResponse.json({ error: 'Unable to check waitlist status.' }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ error: 'You’re already on the waitlist.' }, { status: 409 });
  }

  const { error } = await db.from('waitlist').insert({ email });
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You’re already on the waitlist.' }, { status: 409 });
    }
    console.error('Waitlist insert failed:', error);
    return NextResponse.json({ error: 'Unable to join the waitlist.' }, { status: 500 });
  }

  try {
    await sendWaitlistConfirmation(email);
  } catch (sendError) {
    console.error('Waitlist confirmation email failed:', sendError);
    return NextResponse.json({ error: 'Failed to send confirmation email.' }, { status: 500 });
  }

  try {
    await sendAdminWaitlistNotification(email);
  } catch (adminError) {
    console.error('Admin notification email failed:', adminError);
  }

  return NextResponse.json({ success: true, message: "You're on the waitlist. We'll email you when beta spots open." });

}
