import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { sendFeedback } from '@/lib/email';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authUser = await getApprovedAppUser(req);
  if (!authUser) return unauth();

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const message = (body.message ?? '').trim();
  if (!message || message.length < 5) {
    return NextResponse.json({ error: 'Message too short' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 });
  }

  try {
    await sendFeedback(
      authUser.email ?? 'unknown@laksh.app',
      authUser.display_name ?? 'A user',
      message,
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Feedback email failed:', e);
    return NextResponse.json({ error: 'Failed to send feedback' }, { status: 500 });
  }
}
