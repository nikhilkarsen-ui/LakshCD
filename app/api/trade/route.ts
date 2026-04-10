import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { executeTrade } from '@/lib/trading';

export async function POST(req: NextRequest) {
  const user = await getApprovedAppUser(req);
  if (!user) return unauth();

  const body = await req.json();
  const dollars = Number(body.dollars);
  const side = body.side as 'buy' | 'sell';

  if (!body.player_id || isNaN(dollars) || dollars <= 0 || (side !== 'buy' && side !== 'sell')) {
    return NextResponse.json({ error: 'Need player_id, positive dollars, and side (buy|sell)' }, { status: 400 });
  }

  const result = await executeTrade(user.id, { player_id: body.player_id, side, dollars });
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
