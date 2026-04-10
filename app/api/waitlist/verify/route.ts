import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
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
