// ============================================================
// GET /api/live-data
//
// Lightweight read endpoint for the frontend.
// Returns live game status and stat snapshots for all active players
// directly from live_stat_cache — no BDL call, no heavy computation.
//
// Response shape:
// {
//   hasLiveGames: boolean,
//   players: [{
//     player_id, game_status, pts, ast, reb, stl, blk, tov,
//     period, time_remaining, fetched_at
//   }]
// }
//
// Polled by the frontend every ~10s to display live game context
// (quarter, time, stat line) alongside current prices.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const db = serverSupa();

    const { data: rows, error } = await db
      .from('live_stat_cache')
      .select('player_id, game_id, game_status, pts, ast, reb, stl, blk, tov, period, time_remaining, fetched_at')
      .order('fetched_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const hasLiveGames = (rows ?? []).some((r: any) => r.game_status === 'in_progress');

    return NextResponse.json({
      hasLiveGames,
      players: rows ?? [],
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        // Allow public CDN caching for 10 seconds — stale data is fine here
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20',
      },
    });
  } catch (e: any) {
    console.error('live-data error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
