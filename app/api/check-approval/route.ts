import { NextRequest, NextResponse } from 'next/server';
import { getUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function GET(req: NextRequest) {
  const authUser = await getUser(req);
  if (!authUser?.id) return unauth();

  if (isAdminEmail(authUser.email)) {
    return NextResponse.json({ approved: true, status: 'approved' });
  }

  const db = serverSupa();
  const { data: appUser, error } = await db
    .from('users')
    .select('is_approved')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) {
    console.error('Approval check error:', error);
    return NextResponse.json({ error: 'Unable to verify approval.' }, { status: 500 });
  }

  if (!appUser) {
    return NextResponse.json({ approved: false, status: 'pending' });
  }

  return NextResponse.json({ approved: !!appUser.is_approved, status: appUser.is_approved ? 'approved' : 'pending' });
}
