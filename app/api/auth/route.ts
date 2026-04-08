import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
import { TRADE } from '@/config/constants';

export async function POST(req: NextRequest) {
  const { user_id, email, display_name } = await req.json();
  if (!user_id || !email) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const db = serverSupa();
  const { data: existing } = await db.from('users').select('id').eq('id', user_id).single();
  if (existing) return NextResponse.json({ success: true });
  const { error } = await db.from('users').insert({
    id: user_id, email, display_name: display_name || email.split('@')[0],
    balance: TRADE.initial_balance, initial_balance: TRADE.initial_balance,
  });
  if (error) { console.error('Signup err:', error); return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
