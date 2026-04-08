import { NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

const NUM_FIELDS = ['current_price','previous_price','price_change_24h','price_change_pct_24h','expected_value','volatility','ppg','apg','rpg','efficiency','pool_x','pool_y'];

export async function GET() {
  const db = serverSupa();
  const [{ data, error }, { data: positions }] = await Promise.all([
    db.from('players').select('*').eq('is_active', true).order('current_price', { ascending: false }),
    db.from('positions').select('position_size, player:players(current_price)'),
  ]);
  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 });
  const players = (data || []).map((p: any) => { for (const f of NUM_FIELDS) if (p[f] !== undefined) p[f] = Number(p[f]); return p; });
  const open_interest = (positions || []).reduce((sum: number, p: any) => {
    const size = Math.abs(Number(p.position_size));
    const price = Number(p.player?.current_price || 0);
    return sum + size * price;
  }, 0);
  return NextResponse.json({ players, open_interest: parseFloat(open_interest.toFixed(2)) });
}
