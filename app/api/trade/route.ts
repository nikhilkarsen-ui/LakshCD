import { NextRequest, NextResponse } from 'next/server';
import { getUser, unauth } from '@/lib/auth';
import { executeTrade } from '@/lib/trading';

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return unauth();
  const body = await req.json();
  const dollars = Number(body.dollars);
  if (!body.player_id || isNaN(dollars) || dollars === 0) {
    return NextResponse.json({ error: 'Need player_id and non-zero dollars' }, { status: 400 });
  }
  const result = await executeTrade(user.id, { player_id: body.player_id, dollars });
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
