import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { TRADE } from '@/config/constants';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function POST(req: NextRequest) {
  // Verify the caller is the user they claim to be
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user: authUser } } = await sb.auth.getUser(authHeader.replace('Bearer ', ''));
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { user_id, email } = body;
  if (!user_id || !email) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  // Sanitize display_name: strip HTML, limit length
  const raw_name = typeof body.display_name === 'string' ? body.display_name : '';
  const display_name = raw_name.replace(/<[^>]*>/g, '').trim().slice(0, 40) || undefined;

  // Ensure the token owner matches the requested user_id
  if (authUser.id !== user_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = serverSupa();
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existing } = await db.from('users').select('id').eq('id', user_id).maybeSingle();
  if (existing) return NextResponse.json({ success: true });

  const { data: waitlistRow } = await db
    .from('waitlist')
    .select('status,approved_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  const is_approved = isAdminEmail(normalizedEmail) || waitlistRow?.status === 'approved';
  const approved_at = is_approved ? waitlistRow?.approved_at ?? new Date().toISOString() : null;

  const { error } = await db.from('users').insert({
    id: user_id,
    email: normalizedEmail,
    display_name: display_name || normalizedEmail.split('@')[0],
    balance: TRADE.initial_balance,
    initial_balance: TRADE.initial_balance,
    is_approved,
    approved_at,
  });

  if (error) {
    console.error('Signup err:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
