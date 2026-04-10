import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { executeTrade } from '@/lib/trading';

export async function POST(req: NextRequest) {
  const user = await getApprovedAppUser(req);
  if (!user) return unauth();

  const body = await req.json();
  const dollars = Number(body.dollars);
  const side = body.side as 'buy' | 'sell';
  const sell_all = body.sell_all === true;

  if (!body.player_id || (side !== 'buy' && side !== 'sell')) {
    return NextResponse.json({ error: 'Need player_id and side (buy|sell)' }, { status: 400 });
  }
  if (!sell_all && (isNaN(dollars) || dollars <= 0)) {
    return NextResponse.json({ error: 'Need positive dollars (or sell_all: true)' }, { status: 400 });
  }

  const result = await executeTrade(user.id, { player_id: body.player_id, side, dollars: dollars || 0, sell_all });
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
