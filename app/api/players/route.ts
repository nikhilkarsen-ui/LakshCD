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

    // Sparkline data — last 24h of tick snapshots per player (ticks fire simultaneously,
    // so ordering DESC + limit gives evenly distributed recency across all players).
    // Time filter prevents the global limit from shrinking per-player coverage as
    // the price_history table grows over time.
    let sparklines: Record<string, { price: number }[]> = {};
    if (players.length > 0) {
      const playerIds = players.map((p: any) => p.id);
      // Fetch 25h of history (48 ticks at 30-min cadence, with 1h buffer) then downsample to
      // 60 evenly-spaced points per player for the sparkline. Sending 48 × 80
      // rows to the client is wasteful; 60 points is more than enough visual fidelity.
      const SPARKLINE_POINTS = 60;
      const since25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const { data: hist } = await db
        .from('price_history')
        .select('player_id, price')
        .in('player_id', playerIds)
        .gte('created_at', since25h)
        .order('created_at', { ascending: false })
        .limit(players.length * 100);

      // Group by player (DESC → oldest last), then reverse to ASC and downsample
      const grouped: Record<string, { price: number }[]> = {};
      for (const row of (hist ?? [])) {
        if (!grouped[row.player_id]) grouped[row.player_id] = [];
        grouped[row.player_id].push({ price: Number(row.price) });
      }
      for (const id of Object.keys(grouped)) {
        const asc = grouped[id].reverse(); // DESC→ASC
        if (asc.length <= SPARKLINE_POINTS) { sparklines[id] = asc; continue; }
        // Evenly sample SPARKLINE_POINTS from the full history, always including last point
        const step = (asc.length - 1) / (SPARKLINE_POINTS - 1);
        sparklines[id] = Array.from({ length: SPARKLINE_POINTS }, (_, i) =>
          asc[Math.round(i * step)]
        );
      }
    }

    return NextResponse.json({ players, market_cap: parseFloat(market_cap.toFixed(2)), sparklines });
  } catch (error: any) {
    console.error('Players API error:', error);
    return NextResponse.json({ error: 'Players API failed', details: error.message }, { status: 500 });
  }
}
