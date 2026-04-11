import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

const NF = [
  'current_price','previous_price','price_change_24h','price_change_pct_24h',
  'expected_value','expected_final_value','fair_value','volatility',
  'ppg','apg','rpg','efficiency','pool_x','pool_y','live_game_boost',
];

// Per-timeframe: how far back to look and how many raw rows to fetch.
// We fetch more raw rows than we'll display — the client LTTB-downsamples
// to the visual budget. DESC order ensures we always get the most recent N.
const TIMEFRAME: Record<string, { ms: number; limit: number }> = {
  '1H':  { ms: 1  * 3_600_000,  limit: 800  }, // 5s ticks → up to 720 pts/hr
  '8H':  { ms: 8  * 3_600_000,  limit: 800  }, // raw subsample of 8h window
  '24H': { ms: 24 * 3_600_000,  limit: 800  }, // raw subsample of 24h window
  '1W':  { ms: 7  * 86_400_000, limit: 1000 }, // seed data is hourly → ~168 pts
  'ALL': { ms: 365 * 86_400_000, limit: 1000 }, // full seed history
  // backward-compat aliases
  '1D':  { ms: 24 * 3_600_000,  limit: 800  },
  '1M':  { ms: 30 * 86_400_000, limit: 1000 },
  '3M':  { ms: 90 * 86_400_000, limit: 1000 },
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = serverSupa();

  const { data: player, error } = await db
    .from('players').select('*').eq('id', id).single();
  if (error || !player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  for (const f of NF) if (player[f] !== undefined) player[f] = Number(player[f]);

  const rawRange = req.nextUrl.searchParams.get('range') || '24H';
  const tf = TIMEFRAME[rawRange] ?? TIMEFRAME['24H'];
  const since = new Date(Date.now() - tf.ms).toISOString();

  // Fetch DESC (newest first) then reverse → guaranteed most-recent N points
  // rather than oldest N, which is what ASC+limit would give.
  const { data: history } = await db
    .from('price_history')
    .select('id, player_id, price, expected_value, volatility, created_at')
    .eq('player_id', id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(tf.limit);

  const ph = (history ?? [])
    .reverse() // back to chronological order
    .map((h: any) => ({
      ...h,
      price:          Number(h.price),
      expected_value: Number(h.expected_value),
      volatility:     Number(h.volatility),
    }));

  return NextResponse.json({ player, price_history: ph });
}
