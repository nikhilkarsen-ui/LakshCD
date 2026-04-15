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

const BDL_BASE   = 'https://api.balldontlie.io/v1';
const DELAY_MS   = 1100; // 1100ms = ~54 req/min, safely under the 60 req/min limit
const RETRY_MS   = 35_000; // wait 35s on 429 before retrying

function bdlHeaders(): Record<string, string> {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error('BALLDONTLIE_API_KEY env var is not set');
  return { Authorization: key };
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Rate-limit-safe BDL fetch with one 429 retry */
async function bdlGet(path: string, attempt = 0): Promise<any> {
  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: bdlHeaders(),
    cache: 'no-store',
  });
  if (res.status === 429 && attempt === 0) {
    await delay(RETRY_MS);
    return bdlGet(path, 1);
  }
  if (res.status === 400 || res.status === 402 || res.status === 403 || res.status === 404) {
    return null; // not supported on this tier — caller handles
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
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
  const rawScore =
    (ppg * TOTAL_GAMES / max_pts) * pts_w +
    (apg * TOTAL_GAMES / max_ast) * ast_w +
    (rpg * TOTAL_GAMES / max_reb) * reb_w +
    (eff * TOTAL_GAMES / max_eff) * eff_w;
  const credibility = Math.min(gp / CRED_GAMES, 1);
  const shrunkScore = credibility * rawScore + (1 - credibility) * LEAGUE_AVG;
  const evScore     = Math.max(0, Math.min(1000, shrunkScore * 1000));
  const price       = Math.max(min_price, parseFloat((evScore * fv_scale).toFixed(2)));
  return { evScore, price, priorFvScore: parseFloat(shrunkScore.toFixed(4)) };
}

function computePools(price: number): { pool_x: number; pool_y: number } {
  return {
    pool_x: parseFloat(Math.sqrt(K / price).toFixed(4)),
    pool_y: parseFloat(Math.sqrt(K * price).toFixed(4)),
  };
}

/**
 * Get candidates for a team who have played in the 2025 season.
 *
 * Strategy A: /players?season=2025&team_ids[]=X  → players with 2025 game activity
 * Strategy B: /players?team_ids[]=X              → full historical roster (fallback)
 *
 * Returns at most `limit` candidate players (bdlId, name, position).
 */
async function getTeamCandidates(
  bdlTeamId: number,
  limit: number,
  log: (msg: string) => void,
  teamName: string,
): Promise<Array<{ bdlId: number; name: string; position: string }>> {
  // Try season-filtered first — reduces candidates to players with 2025 activity
  await delay(DELAY_MS);
  let json = await bdlGet(`/players?season=2025&team_ids[]=${bdlTeamId}&per_page=${limit}`);

  if (!json?.data || json.data.length === 0) {
    log(`  [${teamName}] season=2025 filter returned no results — using full roster`);
    await delay(DELAY_MS);
    json = await bdlGet(`/players?team_ids[]=${bdlTeamId}&per_page=${limit}`);
  }

  const players: any[] = json?.data ?? [];
  log(`  [${teamName}] ${players.length} candidates`);

  return players.map((p: any) => ({
    bdlId:    Number(p.id),
    name:     `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    position: p.position || 'F',
  }));
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

    // ── Step 2: Get candidates per team ───────────────────────────────────────
    // Max 15 candidates per team × 12 teams = 180 individual stat requests.
    // At 1100ms each ≈ 198s + overhead = well within 300s.
    const CANDIDATES_PER_TEAM = 15;
    log(`Fetching up to ${CANDIDATES_PER_TEAM} candidates per team...`);

    type Candidate = { bdlId: number; name: string; position: string; teamName: string };
    const allCandidates: Candidate[] = [];

    for (const team of resolvedTeams) {
      const candidates = await getTeamCandidates(team.bdlId, CANDIDATES_PER_TEAM, log, team.name);
      for (const c of candidates) allCandidates.push({ ...c, teamName: team.name });
    }
    log(`Total candidates: ${allCandidates.length}`);

    // ── Step 3: Fetch individual season averages for each candidate ───────────
    log('Fetching individual season averages (1100ms between requests)...');

    type PlayerEntry = {
      bdlPlayerId: number; name: string; position: string; teamName: string;
      mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number;
    };
    const byTeam = new Map<string, PlayerEntry[]>();
    for (const team of resolvedTeams) byTeam.set(team.name, []);

    for (let i = 0; i < allCandidates.length; i++) {
      const c = allCandidates[i];
      await delay(DELAY_MS);

      const json = await bdlGet(`/season_averages?season=2025&player_id=${c.bdlId}`);
      const stats = json?.data?.[0];
      if (!stats) continue;

      const mpg = parseMinutes(stats.min);
      const gp  = Number(stats.games_played || 0);
      if (mpg < 10 || gp < 10) continue; // bench / G-League

      const ppg = parseFloat(Number(stats.pts || 0).toFixed(1));
      const apg = parseFloat(Number(stats.ast || 0).toFixed(1));
      const rpg = parseFloat(Number(stats.reb || 0).toFixed(1));
      const eff = parseFloat(computeEfficiency(stats).toFixed(1));

      byTeam.get(c.teamName)?.push({ bdlPlayerId: c.bdlId, name: c.name, position: c.position, teamName: c.teamName, mpg, ppg, apg, rpg, eff, gp });

      if ((i + 1) % 15 === 0) log(`  ${i + 1}/${allCandidates.length} done`);
    }

    // ── Step 4: Select top 9 per team ────────────────────────────────────────
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
      log('WARNING: Teams with fewer than 9 qualified players:');
      for (const [t, p] of underTeams) log(`  ${t}: only ${p.length} qualified — consider raising CANDIDATES_PER_TEAM`);
    }
    log(`Total players selected: ${finalPlayers.length}`);

    if (finalPlayers.length === 0) {
      throw new Error('No players selected — season averages returned no qualifying data. Check BDL API key and season parameter.');
    }

    // ── Step 5: Delete all existing players ──────────────────────────────────
    log('Deleting all existing players...');
    const { error: deleteErr } = await db.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteErr) throw new Error(`Delete failed: ${deleteErr.message}`);
    log('All players deleted.');

    // ── Step 6: Insert new players ────────────────────────────────────────────
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

    // ── Step 7: Validate ──────────────────────────────────────────────────────
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
      log(`⚠ Done. Total: ${totalCount}. Issues: ${badTeams.map(([t, c]) => `${t}:${c}`).join(', ') || 'none'}`);
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
