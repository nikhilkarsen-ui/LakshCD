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
const K           = 5_000_000; // AMM constant-product invariant
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
  if (res.status === 402 || res.status === 403 || res.status === 404) return null;
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

/** Compute fair value price from stats (Bayesian-shrunk EV × fv_scale) */
function computePrice(ppg: number, apg: number, rpg: number, eff: number, gp: number): {
  evScore: number;
  price: number;
  priorFvScore: number;
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

/** Compute AMM pool params from price */
function computePools(price: number): { pool_x: number; pool_y: number } {
  const pool_y = Math.sqrt(K * price);
  const pool_x = Math.sqrt(K / price);
  return {
    pool_x: parseFloat(pool_x.toFixed(4)),
    pool_y: parseFloat(pool_y.toFixed(4)),
  };
}

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret') || req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log('[rebuild-players]', msg); };

  try {
    const db = serverSupa();

    // ── Step 1: Fetch BDL teams ───────────────────────────────────────────────
    log('Fetching BDL team list...');
    const teamsJson = await bdlGet('/teams?per_page=100');
    if (!teamsJson?.data) throw new Error('Failed to fetch BDL teams');

    const bdlTeamMap = new Map<string, number>(); // full_name → bdl_team_id
    for (const t of teamsJson.data) {
      bdlTeamMap.set(t.full_name, t.id);
    }

    // Resolve target team IDs
    const resolvedTeams: Array<{ name: string; bdlId: number }> = [];
    for (const teamName of TARGET_TEAMS) {
      const bdlId = bdlTeamMap.get(teamName);
      if (!bdlId) {
        log(`WARNING: Could not find BDL team ID for "${teamName}"`);
        continue;
      }
      resolvedTeams.push({ name: teamName, bdlId });
    }
    log(`Resolved ${resolvedTeams.length}/${TARGET_TEAMS.length} teams`);

    // ── Step 2: Fetch active rosters for each team (paginated) ──────────────
    log('Fetching active rosters...');
    // Map: bdlPlayerId → { bdlPlayerId, name, position, teamName }
    const allRosterPlayers = new Map<number, {
      bdlPlayerId: number;
      name: string;
      position: string;
      teamName: string;
    }>();

    for (const team of resolvedTeams) {
      await delay(300);
      // active=1 filters to current roster only — avoids pulling thousands of historical players
      let cursor: number | undefined;
      let pageCount = 0;
      let teamPlayerCount = 0;
      do {
        const cursorParam = cursor ? `&cursor=${cursor}` : '';
        const json = await bdlGet(
          `/players?team_ids[]=${team.bdlId}&active=1&per_page=100${cursorParam}`
        );
        const players: any[] = json?.data ?? [];
        for (const p of players) {
          const fullName = `${p.first_name} ${p.last_name}`.trim();
          const position = p.position || 'F';
          if (!allRosterPlayers.has(p.id)) {
            allRosterPlayers.set(p.id, {
              bdlPlayerId: p.id,
              name: fullName,
              position,
              teamName: team.name,
            });
            teamPlayerCount++;
          }
        }
        cursor = json?.meta?.next_cursor;
        pageCount++;
        if (cursor) await delay(300);
      } while (cursor && pageCount < 5); // max 5 pages (500 players) per team — safety cap
      log(`  ${team.name}: ${teamPlayerCount} active players`);
    }
    log(`Total active roster players to evaluate: ${allRosterPlayers.size}`);

    // ── Step 3: Fetch season averages in chunks of 50 to avoid 431 ───────────
    log('Fetching season averages...');
    const allBdlIds = Array.from(allRosterPlayers.keys());
    const statsMap = new Map<number, any>(); // bdlPlayerId → stats row
    const CHUNK_SIZE = 50;

    for (let i = 0; i < allBdlIds.length; i += CHUNK_SIZE) {
      const chunk = allBdlIds.slice(i, i + CHUNK_SIZE);
      await delay(300);
      const params = chunk.map(id => `player_ids[]=${id}`).join('&');
      const json = await bdlGet(`/season_averages?season=2025&${params}`);

      if (json?.data && json.data.length > 0) {
        for (const entry of json.data) {
          const pid = entry?.player?.id ?? entry?.player_id;
          if (pid != null) statsMap.set(Number(pid), entry);
        }
        log(`  Batch ${Math.floor(i / CHUNK_SIZE) + 1}: fetched ${json.data.length} stats`);
      } else if (json === null) {
        // Tier doesn't support batch — fall back to individual for this chunk
        log(`  Batch not supported — switching to individual requests for chunk ${Math.floor(i / CHUNK_SIZE) + 1}`);
        for (const bdlId of chunk) {
          await delay(350);
          const indJson = await bdlGet(`/season_averages?season=2025&player_id=${bdlId}`);
          const entry = indJson?.data?.[0];
          if (entry) statsMap.set(bdlId, entry);
        }
      } else {
        log(`  Batch ${Math.floor(i / CHUNK_SIZE) + 1}: no data returned`);
      }
    }
    log(`Season averages fetched: ${statsMap.size} players with stats`);

    // ── Step 4: Filter and select top 9 per team ─────────────────────────────
    log('Filtering and selecting top 9 per team...');
    const byTeam = new Map<string, Array<{
      bdlPlayerId: number;
      name: string;
      position: string;
      teamName: string;
      mpg: number;
      ppg: number;
      apg: number;
      rpg: number;
      eff: number;
      gp: number;
    }>>();

    for (const team of resolvedTeams) byTeam.set(team.name, []);

    for (const [bdlId, player] of allRosterPlayers) {
      const stats = statsMap.get(bdlId);
      if (!stats) continue;

      const mpg = parseMinutes(stats.min);
      const gp  = Number(stats.games_played || 0);

      // Filter: must have real playing time and enough games
      if (mpg < 10 || gp < 10) continue;

      const ppg = parseFloat(Number(stats.pts  || 0).toFixed(1));
      const apg = parseFloat(Number(stats.ast  || 0).toFixed(1));
      const rpg = parseFloat(Number(stats.reb  || 0).toFixed(1));
      const eff = parseFloat(computeEfficiency(stats).toFixed(1));

      const teamArr = byTeam.get(player.teamName);
      if (!teamArr) continue;

      teamArr.push({ ...player, mpg, ppg, apg, rpg, eff, gp });
    }

    // Sort each team by mpg desc, then ppg desc; select top 9
    const finalPlayers: Array<{
      bdlPlayerId: number;
      name: string;
      position: string;
      teamName: string;
      mpg: number;
      ppg: number;
      apg: number;
      rpg: number;
      eff: number;
      gp: number;
    }> = [];

    const teamBreakdown: Record<string, string[]> = {};

    for (const [teamName, players] of byTeam) {
      players.sort((a, b) => b.mpg - a.mpg || b.ppg - a.ppg);
      const top9 = players.slice(0, 9);
      finalPlayers.push(...top9);
      teamBreakdown[teamName] = top9.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg)`);
      log(`  ${teamName}: selected ${top9.length}/9 — ${top9.map(p => p.name).join(', ')}`);
    }

    // Validate minimums
    const teamCounts = new Map<string, number>();
    for (const p of finalPlayers) {
      teamCounts.set(p.teamName, (teamCounts.get(p.teamName) ?? 0) + 1);
    }
    const underTeams = [...teamCounts.entries()].filter(([, c]) => c < 9);
    if (underTeams.length > 0) {
      log(`WARNING: Some teams have fewer than 9 qualified players:`);
      for (const [t, c] of underTeams) log(`  ${t}: ${c} players`);
    }

    log(`Total players selected: ${finalPlayers.length}`);

    // ── Step 5: Delete all existing players ──────────────────────────────────
    log('Deleting all existing players (cascades to positions, trades, price_history)...');
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
        name:                    p.name,
        team:                    p.teamName,
        position:                p.position || 'F',
        current_price:           price,
        previous_price:          price,
        price_change_24h:        0,
        price_change_pct_24h:    0,
        expected_value:          parseFloat(evScore.toFixed(2)),
        expected_final_value:    price,
        volatility:              0.05,
        ppg:                     p.ppg,
        apg:                     p.apg,
        rpg:                     p.rpg,
        efficiency:              p.eff,
        games_played:            p.gp,
        pool_x,
        pool_y,
        is_active:               true,
        settlement_status:       'active',
        bdl_player_id:           p.bdlPlayerId,
        stats_synced_at:         now,
        fair_value:              price,
        twap_price:              price,
        twap_30m:                price,
        market_depth:            80000,
        blend_w_amm:             0.15,
        blend_w_fv:              0.65,
        blend_w_twap:            0.20,
        live_game_boost:         0,
        momentum_breaker_active: false,
        prior_fv_score:          priorFvScore,
        created_at:              now,
        updated_at:              now,
      };
    });

    const { error: insertErr } = await db.from('players').insert(inserts);
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
    log(`Inserted ${inserts.length} players.`);

    // ── Step 7: Validate ──────────────────────────────────────────────────────
    log('Validating...');
    const { data: countRows, error: countErr } = await db
      .from('players')
      .select('team');
    if (countErr) throw new Error(`Validation query failed: ${countErr.message}`);

    const totalCount = countRows?.length ?? 0;
    const teamCountMap: Record<string, number> = {};
    for (const row of countRows ?? []) {
      teamCountMap[row.team] = (teamCountMap[row.team] ?? 0) + 1;
    }

    log(`Total players in DB: ${totalCount}`);
    for (const [team, count] of Object.entries(teamCountMap)) {
      log(`  ${team}: ${count} players`);
    }

    const teamsWithWrongCount = Object.entries(teamCountMap).filter(([, c]) => c !== 9);
    if (teamsWithWrongCount.length > 0) {
      log('WARNING: Some teams do not have exactly 9 players:');
      for (const [t, c] of teamsWithWrongCount) log(`  ${t}: ${c}`);
    }

    if (totalCount === 108 && teamsWithWrongCount.length === 0) {
      log('✓ Laksh player universe successfully rebuilt: 108 players, 12 teams × 9 each.');
    } else {
      log(`⚠ Rebuild complete but validation issues detected. Total: ${totalCount}, teams with wrong count: ${teamsWithWrongCount.length}`);
    }

    return NextResponse.json({
      success:         true,
      total_inserted:  totalCount,
      team_breakdown:  teamBreakdown,
      team_counts:     teamCountMap,
      validation_ok:   totalCount === 108 && teamsWithWrongCount.length === 0,
      logs,
    });

  } catch (err: any) {
    log(`ERROR: ${err.message}`);
    console.error('[rebuild-players] Fatal error:', err);
    return NextResponse.json({ success: false, error: err.message, logs }, { status: 500 });
  }
}
