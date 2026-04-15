import { NextRequest, NextResponse } from 'next/server';
import { getUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
import { sendApprovalNotification } from '@/lib/email';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function GET(req: NextRequest) {
  const authUser = await getUser(req);
  if (!authUser?.email || !isAdmin(authUser.email)) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const db = serverSupa();
  const { data, error } = await db
    .from('waitlist')
    .select('id,email,status,created_at,approved_at,notes')
    .neq('status', 'rejected')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin waitlist fetch failed:', error);
    return NextResponse.json({ error: 'Unable to load waitlist.' }, { status: 500 });
  }

  return NextResponse.json({ entries: data });
}

export async function PATCH(req: NextRequest) {
  const authUser = await getUser(req);
  if (!authUser?.email || !isAdmin(authUser.email)) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const body = await req.json();
  const id = typeof body.id === 'string' ? body.id : '';
  const action = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : '';

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id) || !action) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const db = serverSupa();
  const { data: waitlistRow, error: lookupError } = await db
    .from('waitlist')
    .select('id,email')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    console.error('Admin waitlist lookup failed:', lookupError);
    return NextResponse.json({ error: 'Unable to update waitlist entry.' }, { status: 500 });
  }

  if (!waitlistRow) {
    return NextResponse.json({ error: 'Waitlist entry not found.' }, { status: 404 });
  }

  const approvedAt = action === 'approved' ? new Date().toISOString() : null;
  if (action === 'rejected') {
    const { error: deleteError } = await db.from('waitlist').delete().eq('id', id);
    if (deleteError) {
      console.error('Admin waitlist delete failed:', deleteError);
      return NextResponse.json({ error: 'Unable to remove waitlist entry.' }, { status: 500 });
    }
  } else {
    const { error: updateError } = await db
      .from('waitlist')
      .update({ status: action, approved_at: approvedAt })
      .eq('id', id);

    if (updateError) {
      console.error('Admin waitlist update failed:', updateError);
      return NextResponse.json({ error: 'Unable to update waitlist entry.' }, { status: 500 });
    }
  }

  const { error: userUpdateError } = await db
    .from('users')
    .update({ is_approved: action === 'approved', approved_at: approvedAt })
    .eq('email', waitlistRow.email);

  if (userUpdateError) {
    console.error('User approval update failed:', userUpdateError);
  }

  if (action === 'approved') {
    try {
      await sendApprovalNotification(waitlistRow.email);
    } catch (emailError) {
      console.error('Approval notification email failed:', emailError);
    }
  }

  return NextResponse.json({ success: true });
}
