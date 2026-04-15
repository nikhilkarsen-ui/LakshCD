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

// Star players to always inject regardless of whether the team already has ≥9 from the live feed.
// Use this for players who are missing from BDL's stats feed (injured, DNP stretches, etc.)
// but who should still appear in the Laksh universe. Their BDL ID is resolved at runtime via
// a name search so the price cron can track live game data for them.
const FORCED_ADDITIONS: Record<string, Array<{
  name: string; position: string;
  mpg: number; ppg: number; apg: number; rpg: number;
  stl: number; blk: number; fga: number; fgm: number;
  fta: number; ftm: number; tov: number; gp: number;
  searchName: string; // last name (or "First Last") passed to /players?search=
}>> = {
  'Boston Celtics': [
    // Tatum: force-inject because he missed much of 2025-26 (Achilles, returned Mar 2026) —
    // BDL may not have enough games to qualify him via MIN_GAMES filter.
    { name: 'Jayson Tatum',             position: 'SF', mpg: 35.5, ppg: 30.2, apg: 5.1, rpg: 8.5, stl: 1.0, blk: 0.6, fga: 19.0, fgm: 10.0, fta: 7.5, ftm: 6.3, tov: 2.8, gp: 42, searchName: 'Tatum'     },
    // Jrue Holiday was traded to Portland Trail Blazers on June 23, 2025 — removed.
  ],
  'Denver Nuggets': [
    // Force-inject the core Nuggets — BDL's global stats feed historically under-reports Denver.
    // KCP (left Denver), Russell Westbrook (left Denver), and MPJ (long-term injury) removed.
    // Current rotation filled by live BDL data: Cameron Johnson, Tim Hardaway Jr., Jonas Valanciunas.
    { name: 'Nikola Jokic',        position: 'C',  mpg: 34.9, ppg: 29.6, apg: 10.2, rpg: 13.0, stl: 1.4, blk: 1.0, fga: 17.4, fgm: 11.3, fta: 6.2, ftm: 5.2, tov: 3.7, gp: 79, searchName: 'Jokic'       },
    { name: 'Jamal Murray',        position: 'PG', mpg: 35.4, ppg: 25.4, apg:  5.9, rpg:  4.4, stl: 1.0, blk: 0.3, fga: 17.5, fgm:  9.0, fta: 4.6, ftm: 4.0, tov: 2.5, gp: 75, searchName: 'Murray'       },
    { name: 'Aaron Gordon',        position: 'PF', mpg: 31.4, ppg: 16.2, apg:  3.7, rpg:  6.8, stl: 1.0, blk: 0.7, fga: 11.0, fgm:  6.0, fta: 3.0, ftm: 2.3, tov: 1.7, gp: 72, searchName: 'Gordon'       },
    { name: 'Christian Braun',     position: 'SG', mpg: 30.5, ppg: 15.4, apg:  2.5, rpg:  4.0, stl: 0.9, blk: 0.4, fga: 10.2, fgm:  4.9, fta: 2.5, ftm: 2.0, tov: 1.0, gp: 71, searchName: 'Braun'        },
    { name: 'Cameron Johnson',     position: 'SF', mpg: 31.0, ppg: 14.5, apg:  2.2, rpg:  4.2, stl: 0.8, blk: 0.3, fga: 11.5, fgm:  5.3, fta: 2.2, ftm: 1.8, tov: 1.1, gp: 68, searchName: 'Cameron Johnson' },
    { name: 'Tim Hardaway Jr.',    position: 'SG', mpg: 28.0, ppg: 13.5, apg:  2.0, rpg:  3.0, stl: 0.7, blk: 0.2, fga: 11.0, fgm:  5.0, fta: 2.0, ftm: 1.7, tov: 1.0, gp: 65, searchName: 'Hardaway'      },
    { name: 'Peyton Watson',       position: 'SF', mpg: 20.8, ppg:  7.6, apg:  1.2, rpg:  3.9, stl: 0.8, blk: 0.7, fga:  6.2, fgm:  2.9, fta: 1.4, ftm: 1.0, tov: 0.8, gp: 65, searchName: 'Watson'        },
    { name: 'Jonas Valanciunas',   position: 'C',  mpg: 22.0, ppg: 10.2, apg:  1.5, rpg:  8.0, stl: 0.5, blk: 0.7, fga:  8.0, fgm:  4.2, fta: 2.5, ftm: 2.0, tov: 1.3, gp: 60, searchName: 'Valanciunas'   },
    { name: 'Zeke Nnaji',          position: 'C',  mpg: 17.3, ppg:  6.5, apg:  0.9, rpg:  4.2, stl: 0.5, blk: 0.5, fga:  5.8, fgm:  2.9, fta: 1.6, ftm: 1.2, tov: 0.7, gp: 58, searchName: 'Nnaji'         },
  ],
};

// Hardcoded fallback stats — only used when live BDL feed produces < 9 players
// AND the team is not already covered by FORCED_ADDITIONS.
const HARDCODED_TEAM_STATS: Record<string, Array<{
  name: string; position: string;
  mpg: number; ppg: number; apg: number; rpg: number;
  stl: number; blk: number; fga: number; fgm: number;
  fta: number; ftm: number; tov: number; gp: number;
}>> = {
  // Denver is now handled by FORCED_ADDITIONS above (gets real BDL IDs via search)
};

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
    const MAX_PAGES = 60; // 60 pages × 100 rows = 6,000 stat rows ≈ full season

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

    // ── Step 2b: Fallback for teams still short after pagination ─────────────
    // For any team with <9 qualifying players, fetch their roster then check
    // individual season_averages (1100ms throttle, max 15 per team).
    // This handles teams whose BDL team_id doesn't appear in the stats feed
    // (e.g. Denver) or teams that need more pages than the cap allows.
    const shortTeams = resolvedTeams.filter(team => {
      let count = 0;
      for (const agg of allAgg.values()) {
        if (agg.teamName !== team.name) continue;
        const mpg = agg.gamesInSample > 0 ? agg.sumMin / agg.gamesInSample : 0;
        if (mpg >= MIN_MPG && agg.gamesInSample >= 1) count++;
      }
      return count < 9;
    });

    // shortTeamRosters: teamName → Map<playerName, realBdlId>
    // Populated in the fallback loop so Step 2c can assign real BDL IDs to hardcoded players.
    const shortTeamRosters = new Map<string, Map<string, number>>();

    if (shortTeams.length > 0) {
      log(`Running individual fallback for ${shortTeams.length} short team(s): ${shortTeams.map(t => t.name).join(', ')}`);

      for (const team of shortTeams) {
        // Get roster
        await new Promise(r => setTimeout(r, 1100));
        const rosterJson = await bdlGet(`/players?team_ids[]=${team.bdlId}&per_page=25`);
        const roster: any[] = rosterJson?.data ?? [];
        log(`  [${team.name}] roster: ${roster.length} players — checking individual season averages`);

        // Save real BDL IDs by name regardless of whether stats exist
        const nameToId = new Map<string, number>();
        for (const p of roster) {
          const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
          nameToId.set(fullName, Number(p.id));
        }
        shortTeamRosters.set(team.name, nameToId);

        for (const p of roster.slice(0, 20)) {
          await new Promise(r => setTimeout(r, 1100));
          const avgJson = await bdlGet(`/season_averages?season=2025&player_id=${p.id}`);
          const stats   = avgJson?.data?.[0];
          if (!stats) continue;

          const min = parseMinutes(stats.min);
          const gp  = Number(stats.games_played || 0);
          if (min < MIN_MPG || gp < 1) continue;

          const pid = Number(p.id);
          if (allAgg.has(pid)) continue; // already found via stats feed

          allAgg.set(pid, {
            bdlId:    pid,
            name:     `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            position: p.position || 'F',
            teamName: team.name,
            gamesInSample: gp,
            sumMin:  min  * gp,
            sumPts:  Number(stats.pts       || 0) * gp,
            sumAst:  Number(stats.ast       || 0) * gp,
            sumReb:  Number(stats.reb       || 0) * gp,
            sumStl:  Number(stats.stl       || 0) * gp,
            sumBlk:  Number(stats.blk       || 0) * gp,
            sumFga:  Number(stats.fga       || 0) * gp,
            sumFgm:  Number(stats.fgm       || 0) * gp,
            sumFta:  Number(stats.fta       || 0) * gp,
            sumFtm:  Number(stats.ftm       || 0) * gp,
            sumTov:  Number(stats.turnover  || 0) * gp,
          });
        }

        const nowCount = [...allAgg.values()].filter(a => {
          if (a.teamName !== team.name) return false;
          const mpg = a.gamesInSample > 0 ? a.sumMin / a.gamesInSample : 0;
          return mpg >= MIN_MPG;
        }).length;
        log(`  [${team.name}] after fallback: ${nowCount} qualified players`);
      }
    }

    // ── Step 2c: Always inject forced additions (stars missing from BDL feed) ─
    // Runs unconditionally — injects regardless of how many live players the team has.
    // Top-9-by-MPG selection in Step 3 naturally bumps the weakest players out.
    for (const [teamName, forced] of Object.entries(FORCED_ADDITIONS)) {
      const resolvedTeam = resolvedTeams.find(t => t.name === teamName);
      if (!resolvedTeam) continue;

      for (const h of forced) {
        const nameExists = [...allAgg.values()].some(a => a.teamName === teamName && a.name === h.name);
        if (nameExists) continue;

        // Search BDL by name to get the real player ID for live price tracking
        await new Promise(r => setTimeout(r, 800));
        const searchJson = await bdlGet(`/players?search=${encodeURIComponent(h.searchName)}&per_page=10`);
        const match = (searchJson?.data ?? []).find((p: any) =>
          (() => {
            const full = `${p.first_name} ${p.last_name}`.toLowerCase();
            const target = h.name.toLowerCase();
            // Exact match, or last name contains the target last name (handles Jr./accents)
            return full === target || full.includes(target) || target.includes(full) ||
              p.last_name.toLowerCase() === h.name.split(' ').pop()!.toLowerCase().replace('.','');
          })()
        );
        const realId = match ? Number(match.id) : null;

        let syntheticId = -Date.now(); // guaranteed unique fallback
        const bdlId = realId ?? syntheticId;
        if (!realId && allAgg.has(bdlId)) continue;

        log(`  [${teamName}] Force-injecting ${h.name} (BDL ID: ${realId ?? 'none — synthetic'})`);
        allAgg.set(bdlId, {
          bdlId,
          name:     h.name,
          position: h.position,
          teamName,
          gamesInSample: h.gp,
          sumMin:  h.mpg * h.gp,
          sumPts:  h.ppg * h.gp,
          sumAst:  h.apg * h.gp,
          sumReb:  h.rpg * h.gp,
          sumStl:  h.stl * h.gp,
          sumBlk:  h.blk * h.gp,
          sumFga:  h.fga * h.gp,
          sumFgm:  h.fgm * h.gp,
          sumFta:  h.fta * h.gp,
          sumFtm:  h.ftm * h.gp,
          sumTov:  h.tov * h.gp,
        });
      }
    }

    // ── Step 2d: Inject hardcoded players for teams still short ──────────────
    for (const team of resolvedTeams) {
      const hardcoded = HARDCODED_TEAM_STATS[team.name];
      if (!hardcoded) continue;

      // Count how many this team already has
      let alreadyHave = 0;
      for (const agg of allAgg.values()) {
        if (agg.teamName !== team.name) continue;
        const mpg = agg.gamesInSample > 0 ? agg.sumMin / agg.gamesInSample : 0;
        if (mpg >= MIN_MPG && agg.gamesInSample >= 1) alreadyHave++;
      }

      if (alreadyHave >= 9) continue; // live data is sufficient

      const rosterNameToId = shortTeamRosters.get(team.name) ?? new Map<string, number>();
      log(`  [${team.name}] only ${alreadyHave} live players — injecting ${hardcoded.length} hardcoded entries (${rosterNameToId.size} real BDL IDs available)`);

      // Use a synthetic negative bdlId only as a last resort (no match in roster)
      let syntheticId = -1;
      for (const h of hardcoded) {
        // Don't duplicate names already collected
        const nameExists = [...allAgg.values()].some(a => a.teamName === team.name && a.name === h.name);
        if (nameExists) continue;

        // Prefer the real BDL ID so the price cron can fetch live game data for this player
        const realId = rosterNameToId.get(h.name);
        const bdlId  = realId ?? (syntheticId--);
        if (!realId) while (allAgg.has(syntheticId)) syntheticId--;

        allAgg.set(realId ?? bdlId, {
          bdlId:    realId ?? bdlId,
          name:     h.name,
          position: h.position,
          teamName: team.name,
          gamesInSample: h.gp,
          sumMin:  h.mpg * h.gp,
          sumPts:  h.ppg * h.gp,
          sumAst:  h.apg * h.gp,
          sumReb:  h.rpg * h.gp,
          sumStl:  h.stl * h.gp,
          sumBlk:  h.blk * h.gp,
          sumFga:  h.fga * h.gp,
          sumFgm:  h.fgm * h.gp,
          sumFta:  h.fta * h.gp,
          sumFtm:  h.ftm * h.gp,
          sumTov:  h.tov * h.gp,
        });
        syntheticId--;
      }
    }

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
      if (g < 1) continue;

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
        bdl_player_id: p.bdlPlayerId > 0 ? p.bdlPlayerId : null, stats_synced_at: now,
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
