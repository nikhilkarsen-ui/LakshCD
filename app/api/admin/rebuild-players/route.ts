import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

export const maxDuration = 300;

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

const K           = 5_000_000;
const TOTAL_GAMES = 82;
const pts_w = 0.35, ast_w = 0.20, reb_w = 0.20, eff_w = 0.25;
const max_pts = 2800, max_ast = 900, max_reb = 1200, max_eff = 3000;
const fv_scale  = 0.40;
const min_price = 5;
const LEAGUE_AVG = 0.45;
const CRED_GAMES = 20;

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
  if (res.status === 429 && attempt === 0) {
    await new Promise(r => setTimeout(r, 12_000)); // wait 12s then retry
    return bdlGet(path, 1);
  }
  if (!res.ok) return null;
  return res.json();
}

function parseMinutes(min: string | number | null | undefined): number {
  if (min == null) return 0;
  const s = String(min).trim();
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    return (m || 0) + (sec || 0) / 60;
  }
  return parseFloat(s) || 0;
}

function computeEfficiency(s: any): number {
  const n = (v: any) => Number(v || 0);
  return (
    n(s.pts) + n(s.reb) + n(s.ast) + n(s.stl) + n(s.blk)
    - (n(s.fga) - n(s.fgm))
    - (n(s.fta) - n(s.ftm))
    - n(s.turnover)
  );
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

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log('[rebuild-players]', msg); };

  try {
    const db = serverSupa();

    // ── Step 1: Resolve BDL team IDs (1 request) ─────────────────────────────
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

    // ── Step 2: Pull game stats per team, aggregate into per-player averages ──
    //
    // One /stats?seasons[]=2025&team_ids[]=X call per team (12 requests total).
    // Each row is a single player's stats in a single game.
    // We aggregate across all rows per player to get mpg/ppg/rpg/apg.
    // This avoids 150+ sequential /season_averages calls that exceed the timeout.
    //
    // per_page=100 covers ~6–7 games × ~15 players = the full active rotation.

    log('Fetching 2025 game stats per team (12 requests)...');

    type PlayerAgg = {
      bdlId: number; name: string; position: string; teamName: string;
      gamesInSample: number;
      sumMin: number; sumPts: number; sumAst: number; sumReb: number;
      sumStl: number; sumBlk: number; sumFga: number; sumFgm: number;
      sumFta: number; sumFtm: number; sumTov: number;
    };

    const allAgg = new Map<number, PlayerAgg>(); // bdlId → aggregated row
    const playerTeam = new Map<number, string>(); // bdlId → teamName

    for (const team of resolvedTeams) {
      await new Promise(r => setTimeout(r, 500)); // light delay between team requests
      const json = await bdlGet(`/stats?seasons[]=2025&team_ids[]=${team.bdlId}&per_page=100`);
      const rows: any[] = json?.data ?? [];
      log(`  ${team.name}: ${rows.length} game stat rows`);

      for (const row of rows) {
        const pid = row?.player?.id;
        if (pid == null) continue;
        const id = Number(pid);

        // Only count rows where this player actually played (min > 0)
        const min = parseMinutes(row.min);
        if (min === 0) continue;

        if (!allAgg.has(id)) {
          allAgg.set(id, {
            bdlId: id,
            name:     `${row.player.first_name || ''} ${row.player.last_name || ''}`.trim(),
            position: row.player.position || 'F',
            teamName: team.name,
            gamesInSample: 0,
            sumMin: 0, sumPts: 0, sumAst: 0, sumReb: 0,
            sumStl: 0, sumBlk: 0, sumFga: 0, sumFgm: 0,
            sumFta: 0, sumFtm: 0, sumTov: 0,
          });
          playerTeam.set(id, team.name);
        }

        const agg = allAgg.get(id)!;
        agg.gamesInSample++;
        agg.sumMin  += min;
        agg.sumPts  += Number(row.pts      || 0);
        agg.sumAst  += Number(row.ast      || 0);
        agg.sumReb  += Number(row.reb      || 0);
        agg.sumStl  += Number(row.stl      || 0);
        agg.sumBlk  += Number(row.blk      || 0);
        agg.sumFga  += Number(row.fga      || 0);
        agg.sumFgm  += Number(row.fgm      || 0);
        agg.sumFta  += Number(row.fta      || 0);
        agg.sumFtm  += Number(row.ftm      || 0);
        agg.sumTov  += Number(row.turnover || 0);
      }
    }

    log(`Aggregated stats for ${allAgg.size} unique players across all teams`);

    // ── Step 3: Compute per-game averages, filter, select top 9 per team ──────
    log('Computing averages and selecting top 9 per team...');

    type PlayerEntry = {
      bdlPlayerId: number; name: string; position: string; teamName: string;
      mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number;
    };

    const byTeam = new Map<string, PlayerEntry[]>();
    for (const team of resolvedTeams) byTeam.set(team.name, []);

    for (const [, agg] of allAgg) {
      const g = agg.gamesInSample;
      if (g === 0) continue;

      const mpg = agg.sumMin / g;
      if (mpg < 10) continue; // exclude garbage time / DNP players

      const ppg = parseFloat((agg.sumPts / g).toFixed(1));
      const apg = parseFloat((agg.sumAst / g).toFixed(1));
      const rpg = parseFloat((agg.sumReb / g).toFixed(1));
      const effPerGame = (agg.sumPts + agg.sumReb + agg.sumAst + agg.sumStl + agg.sumBlk
        - (agg.sumFga - agg.sumFgm) - (agg.sumFta - agg.sumFtm) - agg.sumTov) / g;
      const eff = parseFloat(effPerGame.toFixed(1));

      byTeam.get(agg.teamName)?.push({
        bdlPlayerId: agg.bdlId, name: agg.name, position: agg.position,
        teamName: agg.teamName, mpg, ppg, apg, rpg, eff,
        gp: g, // gamesInSample used as proxy — good enough for Bayesian credibility
      });
    }

    const finalPlayers: PlayerEntry[] = [];
    const teamBreakdown: Record<string, string[]> = {};

    for (const [teamName, players] of byTeam) {
      players.sort((a, b) => b.mpg - a.mpg || b.ppg - a.ppg);
      const top9 = players.slice(0, 9);
      finalPlayers.push(...top9);
      teamBreakdown[teamName] = top9.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg, ${p.ppg}ppg)`);
      log(`  ${teamName} [${top9.length}/${players.length} qualified]: ${top9.map(p => p.name).join(', ')}`);
    }

    const underTeams = [...byTeam.entries()].filter(([, p]) => p.length < 9);
    if (underTeams.length > 0) {
      log('WARNING: Teams with fewer than 9 qualified players:');
      for (const [t, p] of underTeams) log(`  ${t}: only ${p.length} players met the mpg≥10 threshold`);
    }
    log(`Total players selected: ${finalPlayers.length}`);

    if (finalPlayers.length === 0) {
      throw new Error('No players selected — check BDL API key and whether season 2025 has game data.');
    }

    // ── Step 4: Delete all existing players ──────────────────────────────────
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
        bdl_player_id: p.bdlPlayerId, stats_synced_at: now,
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
