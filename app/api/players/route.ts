import { NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

const NUM_FIELDS = ['current_price','previous_price','price_change_24h','price_change_pct_24h','expected_value','expected_final_value','volatility','ppg','apg','rpg','efficiency','pool_x','pool_y'];

export async function GET() {
  try {
    const db = serverSupa();
    const [{ data, error }, { data: positions }] = await Promise.all([
      db.from('players').select('*').eq('is_active', true).order('current_price', { ascending: false }),
      db.from('positions').select('shares_owned, player:players(current_price)'),
    ]);
    if (error) {
      console.error('Players query error:', error);
      return NextResponse.json({ error: 'Failed to fetch players', details: error.message }, { status: 500 });
    }
    const players = (data || []).map((p: any) => { for (const f of NUM_FIELDS) if (p[f] !== undefined) p[f] = Number(p[f]); return p; });

    // Market cap = sum of (shares_owned * current_price) across all positions
    const market_cap = (positions || []).reduce((sum: number, p: any) => {
      const shares = Number(p.shares_owned);
      const price = Number(p.player?.current_price || 0);
      return sum + shares * price;
    }, 0);

    // Sparkline data — last ~30 tick snapshots per player (ticks fire simultaneously,
    // so ordering DESC + limit gives evenly distributed recency across all players).
    let sparklines: Record<string, { price: number }[]> = {};
    if (players.length > 0) {
      const playerIds = players.map((p: any) => p.id);
      const { data: hist } = await db
        .from('price_history')
        .select('player_id, price')
        .in('player_id', playerIds)
        .order('created_at', { ascending: false })
        .limit(players.length * 30); // ~450 rows for 15 players

      // Group by player, then reverse so oldest → newest
      const grouped: Record<string, { price: number }[]> = {};
      for (const row of (hist ?? [])) {
        if (!grouped[row.player_id]) grouped[row.player_id] = [];
        grouped[row.player_id].push({ price: Number(row.price) });
      }
      for (const id of Object.keys(grouped)) {
        grouped[id].reverse(); // DESC→ASC
      }
      sparklines = grouped;
    }

    return NextResponse.json({ players, market_cap: parseFloat(market_cap.toFixed(2)), sparklines });
  } catch (error: any) {
    console.error('Players API error:', error);
    return NextResponse.json({ error: 'Players API failed', details: error.message }, { status: 500 });
  }
}
