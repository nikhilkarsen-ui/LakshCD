import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { sendWaitlistConfirmation, sendAdminWaitlistNotification } from '@/lib/email';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
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
