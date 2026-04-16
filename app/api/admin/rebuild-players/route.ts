import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

export const maxDuration = 300;

// ── Target teams ──────────────────────────────────────────────────────────────
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

// ── Pricing constants ─────────────────────────────────────────────────────────
const K           = 5_000_000;
const TOTAL_GAMES = 82;
const pts_w = 0.35, ast_w = 0.20, reb_w = 0.20, eff_w = 0.25;
const max_pts = 2800, max_ast = 900, max_reb = 1200, max_eff = 3000;
const fv_scale   = 0.40;
const min_price  = 5;
const LEAGUE_AVG = 0.45;
const CRED_GAMES = 20;
const MIN_MPG    = 8;   // minimum minutes per game to be a rotation player
const MIN_GAMES  = 3;   // minimum games played to trust the data

// ── Forced injections ─────────────────────────────────────────────────────────
// Only used for genuine injury-return edge cases where BDL's season_averages
// may not have enough games to qualify the player. All other players come from
// the live BDL roster → season_averages pipeline below.
//
// These stats represent projected full-season averages (what you'd expect if
// healthy all year). The roster-first pipeline will naturally override these
// with real BDL data if the player has ≥3 games in the feed.
const FORCED_ADDITIONS: Record<string, Array<{
  name: string; position: string;
  mpg: number; ppg: number; apg: number; rpg: number;
  stl: number; blk: number; fga: number; fgm: number;
  fta: number; ftm: number; tov: number; gp: number;
  bdlId?: number;
}>> = {
  'Boston Celtics': [
    // Tatum missed most of 2025-26 (Achilles, returned Mar 2026).
    // BDL feed may have < MIN_GAMES games for him — force-inject so he appears.
    { name: 'Jayson Tatum', position: 'SF', mpg: 35.5, ppg: 30.2, apg: 5.1, rpg: 8.5, stl: 1.0, blk: 0.6, fga: 19.0, fgm: 10.0, fta: 7.5, ftm: 6.3, tov: 2.8, gp: 42 },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const BDL_BASE = 'https://api.balldontlie.io/v1';

function bdlHeaders(): Record<string, string> {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error('BALLDONTLIE_API_KEY env var is not set');
  return { Authorization: key };
}

async function bdlGet(path: string, attempt = 0): Promise<any> {
  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: bdlHeaders(),
    cache: 'no-store',
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, 15_000));
    return bdlGet(path, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function parseMinutes(min: string | number | null | undefined): number {
  if (min == null) return 0;
  const s = String(min).trim();
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    return (m || 0) + (sec || 0) / 60;
  }
  return parseFloat(s) || 0;
}

function computePrice(ppg: number, apg: number, rpg: number, eff: number, gp: number) {
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

function computePools(price: number) {
  return {
    pool_x: parseFloat(Math.sqrt(K / price).toFixed(4)),
    pool_y: parseFloat(Math.sqrt(K * price).toFixed(4)),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
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

    // ── Step 2: Roster-first — fetch current roster per team, then season avgs ─
    //
    // This is the correct approach for team accuracy:
    //   /players?team_ids[]=X  → who is CURRENTLY on this team's roster
    //   /season_averages?season=2025&player_id=Y → their 2025-26 stats
    //
    // A traded player's old team stats don't bleed in because we only look up
    // players who are on the team's current BDL roster.

    type PlayerEntry = {
      bdlPlayerId: number; name: string; position: string; teamName: string;
      mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number;
    };

    const byTeam = new Map<string, PlayerEntry[]>();
    for (const team of resolvedTeams) byTeam.set(team.name, []);

    for (const team of resolvedTeams) {
      log(`[${team.name}] Fetching current roster...`);
      await wait(1100);

      const rosterJson = await bdlGet(`/players?team_ids[]=${team.bdlId}&per_page=100`);
      const roster: any[] = rosterJson?.data ?? [];
      log(`  ${roster.length} players on roster`);

      const teamPlayers: PlayerEntry[] = [];

      for (const player of roster) {
        await wait(1100);
        const pid = Number(player.id);
        const avgJson = await bdlGet(`/season_averages?season=2025&player_id=${pid}`);
        const stats = avgJson?.data?.[0];

        if (!stats) continue;

        const mpg = parseMinutes(stats.min);
        const gp  = Number(stats.games_played ?? 0);

        if (mpg < MIN_MPG || gp < MIN_GAMES) continue;

        const ppg = parseFloat(Number(stats.pts      ?? 0).toFixed(1));
        const apg = parseFloat(Number(stats.ast      ?? 0).toFixed(1));
        const rpg = parseFloat(Number(stats.reb      ?? 0).toFixed(1));
        const stl = Number(stats.stl      ?? 0);
        const blk = Number(stats.blk      ?? 0);
        const fga = Number(stats.fga      ?? 0);
        const fgm = Number(stats.fgm      ?? 0);
        const fta = Number(stats.fta      ?? 0);
        const ftm = Number(stats.ftm      ?? 0);
        const tov = Number(stats.turnover ?? stats.tov ?? 0);

        const effRaw = ppg + rpg + apg + stl + blk - (fga - fgm) - (fta - ftm) - tov;
        const eff    = parseFloat(effRaw.toFixed(1));

        const fullName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        const position = player.position || 'F';

        teamPlayers.push({
          bdlPlayerId: pid, name: fullName, position,
          teamName: team.name, mpg, ppg, apg, rpg, eff, gp,
        });
      }

      log(`  ${teamPlayers.length} qualified players (≥${MIN_MPG}mpg, ≥${MIN_GAMES}gp)`);

      // ── Inject forced additions for this team ─────────────────────────────
      const forced = FORCED_ADDITIONS[team.name] ?? [];
      for (const h of forced) {
        const alreadyHave = teamPlayers.some(p => p.name.toLowerCase() === h.name.toLowerCase());
        if (alreadyHave) {
          log(`  [forced] ${h.name} already in live data — using real stats`);
          continue;
        }

        // Try to resolve BDL ID from the roster we just fetched
        const bdlIdFromRoster = h.bdlId ?? (() => {
          const match = roster.find((p: any) =>
            `${p.first_name} ${p.last_name}`.toLowerCase() === h.name.toLowerCase()
          );
          return match ? Number(match.id) : null;
        })();

        const effRaw = h.ppg + h.rpg + h.apg + h.stl + h.blk - (h.fga - h.fgm) - (h.fta - h.ftm) - h.tov;
        teamPlayers.push({
          bdlPlayerId: bdlIdFromRoster ?? -(Date.now()),
          name: h.name, position: h.position, teamName: team.name,
          mpg: h.mpg, ppg: h.ppg, apg: h.apg, rpg: h.rpg,
          eff: parseFloat(effRaw.toFixed(1)), gp: h.gp,
        });
        log(`  [forced] Injected ${h.name} (BDL ID: ${bdlIdFromRoster ?? 'synthetic'})`);
      }

      // Sort by MPG descending, take top 9
      teamPlayers.sort((a, b) => b.mpg - a.mpg || b.ppg - a.ppg);
      const top9 = teamPlayers.slice(0, 9);
      byTeam.set(team.name, top9);

      log(`  Top 9: ${top9.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg ${p.ppg}ppg)`).join(', ')}`);

      if (top9.length < 9) {
        log(`  ⚠ Only ${top9.length} players for ${team.name} — check BDL roster data`);
      }
    }

    // ── Step 3: Flatten and validate ─────────────────────────────────────────
    const finalPlayers: PlayerEntry[] = [];
    const teamBreakdown: Record<string, string[]> = {};

    for (const [teamName, players] of byTeam) {
      finalPlayers.push(...players);
      teamBreakdown[teamName] = players.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg, ${p.ppg}ppg)`);
    }

    log(`Total players selected: ${finalPlayers.length}`);

    if (finalPlayers.length === 0) {
      throw new Error('No players selected — check BDL API key and season 2025 data.');
    }

    // ── Step 4: Delete existing players ──────────────────────────────────────
    log('Deleting all existing players...');
    const { error: deleteErr } = await db.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteErr) throw new Error(`Delete failed: ${deleteErr.message}`);
    log('Deleted.');

    // ── Step 5: Insert ────────────────────────────────────────────────────────
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
        expected_final_value: price, volatility: 0.05,
        ppg: p.ppg, apg: p.apg, rpg: p.rpg, efficiency: p.eff, games_played: p.gp,
        pool_x, pool_y, is_active: true, settlement_status: 'active',
        bdl_player_id: p.bdlPlayerId > 0 ? p.bdlPlayerId : null,
        stats_synced_at: now,
        fair_value: price, twap_price: price, twap_30m: price,
        market_depth: 80000, blend_w_amm: 0.15, blend_w_fv: 0.65, blend_w_twap: 0.20,
        live_game_boost: 0, momentum_breaker_active: false, prior_fv_score: priorFvScore,
        created_at: now, updated_at: now,
      };
    });

    const { error: insertErr } = await db.from('players').insert(inserts);
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
    log(`Inserted ${inserts.length} players.`);

    // ── Step 6: Validate ──────────────────────────────────────────────────────
    const { data: countRows } = await db.from('players').select('team');
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
