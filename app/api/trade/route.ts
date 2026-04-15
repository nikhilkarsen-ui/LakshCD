import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
import { SEASON } from '@/config/constants';

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  );
}

export async function POST(req: NextRequest) {
  const user = await getApprovedAppUser(req);
  if (!user) return unauth();

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const dollars  = Number(body.dollars);
  const side     = body.side as 'buy' | 'sell';
  const sell_all = body.sell_all === true;
  const ip       = getClientIp(req);

  if (!body.player_id || (side !== 'buy' && side !== 'sell')) {
    return NextResponse.json({ error: 'Need player_id and side (buy|sell)' }, { status: 400 });
  }
  if (!sell_all && (isNaN(dollars) || dollars <= 0)) {
    return NextResponse.json({ error: 'Need positive dollars (or sell_all: true)' }, { status: 400 });
  }

  if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
    return NextResponse.json({ error: 'Season has settled — trading is closed.' }, { status: 400 });
  }

  const db = serverSupa();

  // Verify player exists and is tradeable before queuing
  const { data: player } = await db.from('players').select('id, settlement_status').eq('id', body.player_id).single();
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  if (player.settlement_status === 'settled') {
    return NextResponse.json({ error: 'This player has already settled — trading is closed' }, { status: 400 });
  }

  // Queue the order — it will fill at the next price tick (~5s)
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  const { data: order, error } = await db.from('pending_orders').insert({
    user_id:    user.id,
    player_id:  body.player_id,
    side,
    dollars:    dollars || 0,
    sell_all,
    trade_ip:   ip,
    expires_at: expiresAt,
  }).select('id').single();

  if (error) {
    console.error('Failed to queue order:', error);
    return NextResponse.json({ error: 'Failed to place order — please try again' }, { status: 500 });
  }

  return NextResponse.json({ pending: true, order_id: order.id });
}
