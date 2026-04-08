import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

const NF = ['current_price','previous_price','price_change_24h','price_change_pct_24h','expected_value','volatility','ppg','apg','rpg','efficiency','pool_x','pool_y'];

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const db = serverSupa();
  const { data: player, error } = await db.from('players').select('*').eq('id', id).single();
  if (error || !player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  for (const f of NF) if (player[f] !== undefined) player[f] = Number(player[f]);

  const range = req.nextUrl.searchParams.get('range') || '1D';
  const ms: Record<string, number> = { '1D': 864e5, '1W': 6048e5, '1M': 2592e6, '3M': 7776e6, 'ALL': 3.15e10 };
  const since = new Date(Date.now() - (ms[range] || ms['1D'])).toISOString();

  const { data: history } = await db.from('price_history').select('*')
    .eq('player_id', id).gte('created_at', since)
    .order('created_at', { ascending: true }).limit(500);

  const ph = (history || []).map((h: any) => ({ ...h, price: Number(h.price), expected_value: Number(h.expected_value), volatility: Number(h.volatility) }));
  return NextResponse.json({ player, price_history: ph });
}
