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
const fv_scale   = 0.40;
const min_price  = 5;
const LEAGUE_AVG = 0.45;
const CRED_GAMES = 20;
const MIN_MPG    = 10;   // minimum minutes to be considered a rotation player
const MIN_GAMES  = 3;    // minimum games in our sample to trust the data

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
    await new Promise(r => setTimeout(r, 12_000));
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

function countQualifiedPerTeam(
  allAgg: Map<number, any>,
  teamNames: string[],
): Map<string, number> {
  const counts = new Map<string, number>(teamNames.map(n => [n, 0]));
  for (const agg of allAgg.values()) {
    const mpg = agg.gamesInSample > 0 ? agg.sumMin / agg.gamesInSample : 0;
    if (mpg >= MIN_MPG && agg.gamesInSample >= MIN_GAMES) {
      counts.set(agg.teamName, (counts.get(agg.teamName) ?? 0) + 1);
    }
  }
  return counts;
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

    const bdlTeamMap = new Map<string, number>(); // full_name → bdl_team_id
    for (const t of teamsJson.data) bdlTeamMap.set(t.full_name, t.id);

    const resolvedTeams: Array<{ name: string; bdlId: number }> = [];
    for (const teamName of TARGET_TEAMS) {
      const bdlId = bdlTeamMap.get(teamName);
      if (!bdlId) { log(`WARNING: No BDL team ID for "${teamName}"`); continue; }
      resolvedTeams.push({ name: teamName, bdlId });
    }
    log(`Resolved ${resolvedTeams.length}/${TARGET_TEAMS.length} teams`);

    const targetTeamIds  = new Set(resolvedTeams.map(t => t.bdlId));
    const teamIdToName   = new Map(resolvedTeams.map(t => [t.bdlId, t.name]));
    const resolvedNames  = resolvedTeams.map(t => t.name);

    // ── Step 2: Paginate global 2025 stats, bucket by team ────────────────────
    //
    // /stats?seasons[]=2025 returns all game stat rows sorted most-recent-first.
    // team_ids[] is ignored on this tier — we filter by row.team.id ourselves.
    // We paginate until every target team has ≥9 players with mpg≥10 in sample,
    // or we hit MAX_PAGES (safety cap).
    //
    // Each page = 100 rows ≈ 4 games. At 800ms/page, 20 pages ≤ 16 seconds.

    log('Paginating 2025 game stats to collect per-player data for all 12 teams...');

    type PlayerAgg = {
      bdlId: number; name: string; position: string; teamName: string;
      gamesInSample: number;
      sumMin: number; sumPts: number; sumAst: number; sumReb: number;
      sumStl: number; sumBlk: number; sumFga: number; sumFgm: number;
      sumFta: number; sumFtm: number; sumTov: number;
    };

    const allAgg = new Map<number, PlayerAgg>();
    let cursor: number | null = null;
    let page = 0;
    const MAX_PAGES = 30; // 30 pages × 100 rows = 3,000 stat rows ≈ 2–3 months of games

    do {
      await new Promise(r => setTimeout(r, 800));
      const cursorParam = cursor ? `&cursor=${cursor}` : '';
      const json = await bdlGet(`/stats?seasons[]=2025&per_page=100${cursorParam}`);
      if (!json?.data || json.data.length === 0) { log('  Stats feed exhausted'); break; }

      let rowsMatchingTargets = 0;
      for (const row of json.data as any[]) {
        const rowTeamId = Number(row?.team?.id);
        if (!rowTeamId || !targetTeamIds.has(rowTeamId)) continue;

        const min = parseMinutes(row.min);
        if (min === 0) continue; // DNP / no minutes

        const pid = Number(row?.player?.id);
        if (!pid) continue;

        const teamName = teamIdToName.get(rowTeamId)!;

        if (!allAgg.has(pid)) {
          allAgg.set(pid, {
            bdlId: pid,
            name:     `${row.player?.first_name || ''} ${row.player?.last_name || ''}`.trim(),
            position: row.player?.position || 'F',
            teamName,
            gamesInSample: 0,
            sumMin: 0, sumPts: 0, sumAst: 0, sumReb: 0,
            sumStl: 0, sumBlk: 0, sumFga: 0, sumFgm: 0,
            sumFta: 0, sumFtm: 0, sumTov: 0,
          });
        }

        const agg = allAgg.get(pid)!;
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
        rowsMatchingTargets++;
      }

      page++;
      cursor = json.meta?.next_cursor ?? null;

      // Check if every target team has ≥9 qualified players yet
      const qCounts = countQualifiedPerTeam(allAgg, resolvedNames);
      const ready   = resolvedNames.filter(n => (qCounts.get(n) ?? 0) >= 9).length;
      log(`  Page ${page}: +${rowsMatchingTargets} rows → ${allAgg.size} unique players. Teams ready: ${ready}/${resolvedNames.length}`);

      if (ready === resolvedNames.length) {
        log('All teams have ≥9 qualified players — stopping pagination.');
        break;
      }

    } while (cursor && page < MAX_PAGES);

    log(`Pagination complete. ${allAgg.size} unique players across target teams.`);

    // ── Step 3: Compute averages, filter, select top 9 per team ──────────────
    log('Selecting top 9 per team by minutes per game...');

    type PlayerEntry = {
      bdlPlayerId: number; name: string; position: string; teamName: string;
      mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number;
    };

    const byTeam = new Map<string, PlayerEntry[]>();
    for (const team of resolvedTeams) byTeam.set(team.name, []);

    for (const agg of allAgg.values()) {
      const g = agg.gamesInSample;
      if (g < MIN_GAMES) continue;

      const mpg = agg.sumMin / g;
      if (mpg < MIN_MPG) continue;

      const ppg = parseFloat((agg.sumPts / g).toFixed(1));
      const apg = parseFloat((agg.sumAst / g).toFixed(1));
      const rpg = parseFloat((agg.sumReb / g).toFixed(1));
      const effTotal = agg.sumPts + agg.sumReb + agg.sumAst + agg.sumStl + agg.sumBlk
        - (agg.sumFga - agg.sumFgm) - (agg.sumFta - agg.sumFtm) - agg.sumTov;
      const eff = parseFloat((effTotal / g).toFixed(1));

      byTeam.get(agg.teamName)?.push({
        bdlPlayerId: agg.bdlId, name: agg.name, position: agg.position,
        teamName: agg.teamName, mpg, ppg, apg, rpg, eff, gp: g,
      });
    }

    const finalPlayers: PlayerEntry[] = [];
    const teamBreakdown: Record<string, string[]> = {};

    for (const [teamName, players] of byTeam) {
      players.sort((a, b) => b.mpg - a.mpg || b.ppg - a.ppg);
      const top9 = players.slice(0, 9);
      finalPlayers.push(...top9);
      teamBreakdown[teamName] = top9.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg, ${p.ppg}ppg)`);
      log(`  ${teamName} [${top9.length}/${players.length} q]: ${top9.map(p => p.name).join(', ')}`);
    }

    const underTeams = [...byTeam.entries()].filter(([, p]) => p.length < 9);
    if (underTeams.length > 0) {
      log('WARNING: Teams with fewer than 9 qualified players:');
      for (const [t, p] of underTeams) log(`  ${t}: ${p.length} — may need more pages`);
    }
    log(`Total players selected: ${finalPlayers.length}`);

    if (finalPlayers.length === 0) {
      throw new Error('No players selected — check BDL API key and season 2025 game data.');
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
