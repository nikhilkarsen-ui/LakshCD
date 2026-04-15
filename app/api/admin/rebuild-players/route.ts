import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

export const maxDuration = 300;

// ── Target teams (12 teams × 9 players = 108) ─────────────────────────────────
const TARGET_TEAMS = [
  'Detroit Pistons',
  'Boston Celtics',
  'New York Knicks',
  'Cleveland Cavaliers',
  'Toronto Raptors',
  'Atlanta Hawks',
  'Oklahoma City Thunder',
  'San Antonio Spurs',
  'Denver Nuggets',
  'Los Angeles Lakers',
  'Houston Rockets',
  'Minnesota Timberwolves',
];

// ── Pricing constants (mirrors PRICING_V3 in config/constants.ts) ──────────────
const K           = 5_000_000;
const TOTAL_GAMES = 82;
const pts_w       = 0.35, ast_w = 0.20, reb_w = 0.20, eff_w = 0.25;
const max_pts     = 2800, max_ast = 900, max_reb = 1200, max_eff = 3000;
const fv_scale    = 0.40;
const min_price   = 5;
const LEAGUE_AVG  = 0.45;
const CRED_GAMES  = 20;

const BDL_BASE = 'https://api.balldontlie.io/v1';

function bdlHeaders(): Record<string, string> {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error('BALLDONTLIE_API_KEY env var is not set');
  return { Authorization: key };
}

async function bdlGet(path: string): Promise<any> {
  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: bdlHeaders(),
    cache: 'no-store',
  });
  // Treat 400/402/403/404 as "not supported" — return null so caller can handle
  if (res.status === 400 || res.status === 402 || res.status === 403 || res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Parse minutes field — BDL may return "35:12" or "35.3" or a number */
function parseMinutes(min: string | number | null | undefined): number {
  if (min == null) return 0;
  const s = String(min).trim();
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    return (m || 0) + (sec || 0) / 60;
  }
  return parseFloat(s) || 0;
}

/** NBA Efficiency = PTS + REB + AST + STL + BLK − (FGA−FGM) − (FTA−FTM) − TOV */
function computeEfficiency(s: any): number {
  const n = (v: any) => Number(v || 0);
  return (
    n(s.pts) + n(s.reb) + n(s.ast) + n(s.stl) + n(s.blk)
    - (n(s.fga) - n(s.fgm))
    - (n(s.fta) - n(s.ftm))
    - n(s.turnover)
  );
}

function computePrice(ppg: number, apg: number, rpg: number, eff: number, gp: number): {
  evScore: number; price: number; priorFvScore: number;
} {
  const projPts = ppg * TOTAL_GAMES;
  const projAst = apg * TOTAL_GAMES;
  const projReb = rpg * TOTAL_GAMES;
  const projEff = eff * TOTAL_GAMES;
  const rawScore =
    (projPts / max_pts) * pts_w +
    (projAst / max_ast) * ast_w +
    (projReb / max_reb) * reb_w +
    (projEff / max_eff) * eff_w;
  const credibility  = Math.min(gp / CRED_GAMES, 1);
  const shrunkScore  = credibility * rawScore + (1 - credibility) * LEAGUE_AVG;
  const evScore      = Math.max(0, Math.min(1000, shrunkScore * 1000));
  const price        = Math.max(min_price, parseFloat((evScore * fv_scale).toFixed(2)));
  return { evScore, price, priorFvScore: parseFloat(shrunkScore.toFixed(4)) };
}

function computePools(price: number): { pool_x: number; pool_y: number } {
  return {
    pool_x: parseFloat(Math.sqrt(K / price).toFixed(4)),
    pool_y: parseFloat(Math.sqrt(K * price).toFixed(4)),
  };
}

// ── Season averages fetcher: tries team_id batch, falls back to individual ──────
// Returns: Map<bdlPlayerId, { stats, playerName, position }>
async function fetchTeamSeasonAverages(
  bdlTeamId: number,
  teamName: string,
  log: (msg: string) => void
): Promise<Map<number, { stats: any; playerName: string; position: string }>> {
  const result = new Map<number, { stats: any; playerName: string; position: string }>();

  // Strategy A: /season_averages?season=2025&team_id=X (single request per team)
  // Returns only players who actually played for this team in 2025, with stats.
  log(`  [${teamName}] Trying team_id season averages...`);
  await delay(300);
  const teamJson = await bdlGet(`/season_averages?season=2025&team_id=${bdlTeamId}&per_page=100`);

  if (teamJson?.data && teamJson.data.length > 0) {
    for (const entry of teamJson.data) {
      // Response shape: { player: { id, first_name, last_name, position }, ...stats }
      const pid      = entry?.player?.id;
      const stats    = entry;
      const name     = entry.player
        ? `${entry.player.first_name || ''} ${entry.player.last_name || ''}`.trim()
        : 'Unknown';
      const position = entry.player?.position || 'F';
      if (pid != null) result.set(Number(pid), { stats, playerName: name, position });
    }
    log(`  [${teamName}] team_id returned ${result.size} players with 2025 stats`);
    return result;
  }

  // Strategy B: team_id not supported — fetch roster then individual stats
  log(`  [${teamName}] team_id not supported — fetching roster then individual stats`);
  await delay(300);
  const rosterJson = await bdlGet(`/players?team_ids[]=${bdlTeamId}&per_page=100`);
  const roster: any[] = rosterJson?.data ?? [];

  // Take first 30 players from roster to keep request count manageable
  const sample = roster.slice(0, 30);
  log(`  [${teamName}] Fetching individual stats for ${sample.length} roster players...`);

  for (const p of sample) {
    await delay(350);
    const indJson = await bdlGet(`/season_averages?season=2025&player_id=${p.id}`);
    const entry   = indJson?.data?.[0];
    if (entry) {
      const name     = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const position = p.position || 'F';
      result.set(Number(p.id), { stats: entry, playerName: name, position });
    }
  }

  log(`  [${teamName}] individual fallback: ${result.size} players with stats`);
  return result;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log('[rebuild-players]', msg); };

  try {
    const db = serverSupa();

    // ── Step 1: Resolve BDL team IDs ─────────────────────────────────────────
    log('Fetching BDL team list...');
    const teamsJson = await bdlGet('/teams?per_page=100');
    if (!teamsJson?.data) throw new Error('Failed to fetch BDL teams');

    const bdlTeamMap = new Map<string, number>();
    for (const t of teamsJson.data) bdlTeamMap.set(t.full_name, t.id);

    const resolvedTeams: Array<{ name: string; bdlId: number }> = [];
    for (const teamName of TARGET_TEAMS) {
      const bdlId = bdlTeamMap.get(teamName);
      if (!bdlId) { log(`WARNING: No BDL team ID for "${teamName}"`); continue; }
      resolvedTeams.push({ name: teamName, bdlId });
    }
    log(`Resolved ${resolvedTeams.length}/${TARGET_TEAMS.length} teams`);

    // ── Step 2: Fetch season averages per team (13 API calls total) ───────────
    // Using team_id filter on season_averages gives us ONLY players who actually
    // played for that team in the current season — no bloated historical roster needed.
    log('Fetching 2025 season averages per team...');

    type PlayerEntry = {
      bdlPlayerId: number;
      name: string;
      position: string;
      teamName: string;
      mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number;
    };

    const byTeam = new Map<string, PlayerEntry[]>();
    for (const team of resolvedTeams) byTeam.set(team.name, []);

    for (const team of resolvedTeams) {
      const statsMap = await fetchTeamSeasonAverages(team.bdlId, team.name, log);

      for (const [bdlId, { stats, playerName, position }] of statsMap) {
        const mpg = parseMinutes(stats.min);
        const gp  = Number(stats.games_played || 0);
        if (mpg < 10 || gp < 10) continue; // skip bench/G-League players

        const ppg = parseFloat(Number(stats.pts || 0).toFixed(1));
        const apg = parseFloat(Number(stats.ast || 0).toFixed(1));
        const rpg = parseFloat(Number(stats.reb || 0).toFixed(1));
        const eff = parseFloat(computeEfficiency(stats).toFixed(1));

        byTeam.get(team.name)!.push({ bdlPlayerId: bdlId, name: playerName, position, teamName: team.name, mpg, ppg, apg, rpg, eff, gp });
      }
    }

    // ── Step 3: Select top 9 per team ────────────────────────────────────────
    log('Selecting top 9 per team by minutes...');
    const finalPlayers: PlayerEntry[] = [];
    const teamBreakdown: Record<string, string[]> = {};

    for (const [teamName, players] of byTeam) {
      players.sort((a, b) => b.mpg - a.mpg || b.ppg - a.ppg);
      const top9 = players.slice(0, 9);
      finalPlayers.push(...top9);
      teamBreakdown[teamName] = top9.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg, ${p.ppg}ppg)`);
      log(`  ${teamName} [${top9.length}]: ${top9.map(p => p.name).join(', ')}`);
    }

    const underTeams = [...byTeam.entries()].filter(([, p]) => p.length < 9);
    if (underTeams.length > 0) {
      log(`WARNING: Teams with fewer than 9 qualified players:`);
      for (const [t, p] of underTeams) log(`  ${t}: ${p.length}`);
    }
    log(`Total players selected: ${finalPlayers.length}`);

    // ── Step 4: Delete all existing players ──────────────────────────────────
    log('Deleting all existing players...');
    const { error: deleteErr } = await db.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteErr) throw new Error(`Delete failed: ${deleteErr.message}`);
    log('All players deleted.');

    // ── Step 5: Insert new players ────────────────────────────────────────────
    log('Inserting new players...');
    const now = new Date().toISOString();

    const inserts = finalPlayers.map(p => {
      const { evScore, price, priorFvScore } = computePrice(p.ppg, p.apg, p.rpg, p.eff, p.gp);
      const { pool_x, pool_y } = computePools(price);
      return {
        name: p.name, team: p.teamName, position: p.position || 'F',
        current_price: price, previous_price: price,
        price_change_24h: 0, price_change_pct_24h: 0,
        expected_value: parseFloat(evScore.toFixed(2)),
        expected_final_value: price,
        volatility: 0.05,
        ppg: p.ppg, apg: p.apg, rpg: p.rpg, efficiency: p.eff, games_played: p.gp,
        pool_x, pool_y,
        is_active: true, settlement_status: 'active',
        bdl_player_id: p.bdlPlayerId, stats_synced_at: now,
        fair_value: price, twap_price: price, twap_30m: price,
        market_depth: 80000, blend_w_amm: 0.15, blend_w_fv: 0.65, blend_w_twap: 0.20,
        live_game_boost: 0, momentum_breaker_active: false,
        prior_fv_score: priorFvScore,
        created_at: now, updated_at: now,
      };
    });

    const { error: insertErr } = await db.from('players').insert(inserts);
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
    log(`Inserted ${inserts.length} players.`);

    // ── Step 6: Validate ──────────────────────────────────────────────────────
    log('Validating...');
    const { data: countRows, error: countErr } = await db.from('players').select('team');
    if (countErr) throw new Error(`Validation query failed: ${countErr.message}`);

    const totalCount = countRows?.length ?? 0;
    const teamCountMap: Record<string, number> = {};
    for (const row of countRows ?? []) teamCountMap[row.team] = (teamCountMap[row.team] ?? 0) + 1;

    for (const [team, count] of Object.entries(teamCountMap)) log(`  ${team}: ${count}`);

    const badTeams = Object.entries(teamCountMap).filter(([, c]) => c !== 9);
    if (totalCount === 108 && badTeams.length === 0) {
      log('✓ Laksh player universe successfully rebuilt: 108 players, 12 teams × 9 each.');
    } else {
      log(`⚠ Rebuild done. Total: ${totalCount}. Teams with wrong count: ${badTeams.map(([t, c]) => `${t}:${c}`).join(', ') || 'none'}`);
    }

    return NextResponse.json({
      success: true,
      total_inserted: totalCount,
      team_breakdown: teamBreakdown,
      team_counts: teamCountMap,
      validation_ok: totalCount === 108 && badTeams.length === 0,
      logs,
    });

  } catch (err: any) {
    log(`ERROR: ${err.message}`);
    console.error('[rebuild-players] Fatal error:', err);
    return NextResponse.json({ success: false, error: err.message, logs }, { status: 500 });
  }
}
