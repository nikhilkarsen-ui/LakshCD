import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';

export const maxDuration = 300;

// ── Pricing constants ─────────────────────────────────────────────────────────
const K           = 5_000_000;
const TOTAL_GAMES = 82;
const pts_w = 0.35, ast_w = 0.20, reb_w = 0.20, eff_w = 0.25;
const max_pts = 2800, max_ast = 900, max_reb = 1200, max_eff = 3000;
const fv_scale   = 0.40;
const min_price  = 5;
const LEAGUE_AVG = 0.45;
const CRED_GAMES = 20;
const MIN_MPG    = 8;
const MIN_GAMES  = 3;

// ── Target players per team ───────────────────────────────────────────────────
// Exactly 5 players per team; all 5 are selected (no MPG culling).
// bdlLast: override search term when BDL stores a different last name.
// aliases: additional full-name spellings BDL might return.
const TEAM_PLAYERS: Record<string, {
  first: string; last: string; position: string;
  bdlLast?: string; aliases?: string[];
}[]> = {
  'Detroit Pistons': [
    { first: 'Cade',       last: 'Cunningham',  position: 'PG' },
    { first: 'Caris',      last: 'LeVert',      position: 'SG' },
    { first: 'Paul',       last: 'Reed',        position: 'PF' },
    { first: 'Tobias',     last: 'Harris',      position: 'SF' },
    { first: 'Isaiah',     last: 'Stewart',     position: 'C'  },
  ],
  'Boston Celtics': [
    { first: 'Jayson',     last: 'Tatum',       position: 'SF' },
    { first: 'Jaylen',     last: 'Brown',       position: 'SG' },
    { first: 'Derrick',    last: 'White',       position: 'SG' },
    { first: 'Nicola',     last: 'Vucevic',     position: 'C',  aliases: ['Nikola Vucevic'] },
    { first: 'Sam',        last: 'Hauser',      position: 'SF' },
  ],
  'New York Knicks': [
    { first: 'Jalen',      last: 'Brunson',     position: 'PG' },
    { first: 'Karl-Anthony', last: 'Towns',     position: 'C'  },
    { first: 'Jose',       last: 'Alvarado',    position: 'PG' },
    { first: 'Tyler',      last: 'Kolek',       position: 'PG' },
    { first: 'Miles',      last: 'McBride',     position: 'PG' },
  ],
  'Cleveland Cavaliers': [
    { first: 'Donovan',    last: 'Mitchell',    position: 'SG' },
    { first: 'Evan',       last: 'Mobley',      position: 'PF' },
    { first: 'Jarrett',    last: 'Allen',       position: 'C'  },
    { first: 'James',      last: 'Harden',      position: 'PG' },
    { first: 'Dean',       last: 'Wade',        position: 'SF' },
  ],
  'Toronto Raptors': [
    { first: 'Scottie',    last: 'Barnes',      position: 'SF' },
    { first: 'Brandon',    last: 'Ingram',      position: 'SF' },
    { first: 'Jamal',      last: 'Shead',       position: 'PG' },
    { first: "Ja'Kobe",    last: 'Walter',      position: 'SG' },
    { first: 'A.J.',       last: 'Lawson',      position: 'SF', aliases: ['AJ Lawson'] },
  ],
  'Atlanta Hawks': [
    { first: 'Jalen',      last: 'Johnson',     position: 'SF' },
    { first: 'C.J.',       last: 'McCollum',    position: 'SG', aliases: ['CJ McCollum'] },
    { first: 'Nickeil',    last: 'Alexander-Walker', position: 'SG' },
    { first: 'Dyson',      last: 'Daniels',     position: 'SG' },
    { first: 'Onyeka',     last: 'Okongwu',     position: 'C'  },
  ],
  'Oklahoma City Thunder': [
    { first: 'Shai',       last: 'Gilgeous-Alexander', position: 'PG' },
    { first: 'Chet',       last: 'Holmgren',    position: 'C'  },
    { first: 'Jalen',      last: 'Williams',    position: 'SG' },
    { first: 'Luguentz',   last: 'Dort',        position: 'SG', aliases: ['Lu Dort'] },
    { first: 'Isaiah',     last: 'Hartenstein', position: 'C'  },
  ],
  'San Antonio Spurs': [
    { first: 'Victor',     last: 'Wembanyama',  position: 'C'  },
    { first: "De'Aaron",   last: 'Fox',         position: 'PG' },
    { first: 'Devin',      last: 'Vassell',     position: 'SG' },
    { first: 'Stephon',    last: 'Castle',      position: 'PG' },
    { first: 'Julian',     last: 'Champagnie',  position: 'SF' },
  ],
  'Denver Nuggets': [
    { first: 'Nikola',     last: 'Jokić',       position: 'C',  bdlLast: 'Jokic', aliases: ['Nikola Jokic'] },
    { first: 'Jamal',      last: 'Murray',      position: 'PG' },
    { first: 'Aaron',      last: 'Gordon',      position: 'PF' },
    { first: 'Cameron',    last: 'Johnson',     position: 'SF' },
    { first: 'Christian',  last: 'Braun',       position: 'SG' },
  ],
  'Los Angeles Lakers': [
    { first: 'LeBron',     last: 'James',       position: 'SF' },
    { first: 'Deandre',    last: 'Ayton',       position: 'C'  },
    { first: 'Marcus',     last: 'Smart',       position: 'PG' },
    { first: 'Luke',       last: 'Kennard',     position: 'SG' },
    { first: 'Rui',        last: 'Hachimura',   position: 'SF' },
  ],
  'Houston Rockets': [
    { first: 'Kevin',      last: 'Durant',      position: 'SF' },
    { first: 'Alperen',    last: 'Şengün',      position: 'C',  bdlLast: 'Sengun', aliases: ['Alperen Sengun'] },
    { first: 'Jabari',     last: 'Smith',       position: 'PF', aliases: ['Jabari Smith Jr.'] },
    { first: 'Amen',       last: 'Thompson',    position: 'PF' },
    { first: 'Reed',       last: 'Sheppard',    position: 'PG' },
  ],
  'Minnesota Timberwolves': [
    { first: 'Anthony',    last: 'Edwards',     position: 'SG' },
    { first: 'Rudy',       last: 'Gobert',      position: 'C'  },
    { first: 'Julius',     last: 'Randle',      position: 'PF' },
    { first: 'Jaden',      last: 'McDaniels',   position: 'SF' },
    { first: 'Donte',      last: 'DiVincenzo',  position: 'SG' },
  ],
  'Golden State Warriors': [
    { first: 'Stephen',    last: 'Curry',       position: 'PG' },
    { first: 'Kristaps',   last: 'Porzingis',   position: 'C'  },
    { first: 'Draymond',   last: 'Green',       position: 'PF' },
    { first: 'Brandin',    last: 'Podziemski',  position: 'SG' },
    { first: 'Al',         last: 'Horford',     position: 'PF' },
  ],
  'Philadelphia 76ers': [
    { first: 'Tyrese',     last: 'Maxey',       position: 'PG' },
    { first: 'Andre',      last: 'Drummond',    position: 'C'  },
    { first: 'Paul',       last: 'George',      position: 'SF' },
    { first: 'VJ',         last: 'Edgecombe',   position: 'SG', aliases: ['V.J. Edgecombe'] },
    { first: 'Kelly',      last: 'Oubre',       position: 'SF', aliases: ['Kelly Oubre Jr.'] },
  ],
  'Charlotte Hornets': [
    { first: 'LaMelo',     last: 'Ball',        position: 'PG' },
    { first: 'Miles',      last: 'Bridges',     position: 'SF' },
    { first: 'Brandon',    last: 'Miller',      position: 'SG' },
    { first: 'Coby',       last: 'White',       position: 'PG' },
    { first: 'Moussa',     last: 'Diabaté',     position: 'C',  bdlLast: 'Diabate', aliases: ['Moussa Diabate'] },
  ],
  'Portland Trail Blazers': [
    { first: 'Deni',       last: 'Avdija',      position: 'SF' },
    { first: 'Jrue',       last: 'Holiday',     position: 'PG' },
    { first: 'Jerami',     last: 'Grant',       position: 'PF' },
    { first: 'Shaedon',    last: 'Sharpe',      position: 'SG' },
    { first: 'Toumani',    last: 'Camara',      position: 'SF' },
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BDL_BASE}${path}`, {
      headers: bdlHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 429 && attempt < 2) {
      await wait(4000);
      return bdlGet(path, attempt + 1);
    }
    if (!res.ok) return null;
    return res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
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

// Run an array of async tasks with limited concurrency.
// delayMs is the pause between batches to avoid rate-limit bursts.
async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  delayMs = 400,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
    if (i + concurrency < tasks.length) await wait(delayMs);
  }
  return results;
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

    // ── Step 1: Resolve BDL player IDs via name search ────────────────────────
    // Search for each hardcoded player by last name, match by full name.
    // 60 players → concurrency=2, 1200ms gap → ~2 min total.
    log('Resolving BDL player IDs...');

    type NameEntry = { teamName: string; first: string; last: string; position: string };
    const allEntries: NameEntry[] = [];
    for (const [teamName, players] of Object.entries(TEAM_PLAYERS)) {
      for (const p of players) allEntries.push({ teamName, ...p });
    }

    // Search tasks: search BDL by LAST NAME only (BDL's search does prefix
    // matching on individual fields — full-name queries return 0 results).
    // Use per_page=100 so common last names (Green, Mitchell, Williams) return
    // enough results. bdlLast overrides the search term for Jr-suffix players.
    // Concurrency=2, 1200ms gap → ~100/min, avoids rate-limit bursts.
    const searchTasks = allEntries.map(entry => async () => {
      const searchLast = (entry as any).bdlLast ?? entry.last;
      const searchTerm = encodeURIComponent(searchLast);
      const json = await bdlGet(`/players?search=${searchTerm}&per_page=100`);
      const results: any[] = json?.data ?? [];

      // Exact full-name match using bdlLast if set (e.g. "Porter Jr.")
      const bdlFullName = `${entry.first} ${searchLast}`.toLowerCase();
      const stdFullName = `${entry.first} ${entry.last}`.toLowerCase();
      const aliases: string[] = ((entry as any).aliases ?? []).map((a: string) => a.toLowerCase());

      const match = results.find((p: any) => {
        const n = `${p.first_name} ${p.last_name}`.toLowerCase();
        return n === bdlFullName || n === stdFullName || aliases.includes(n);
      });

      return { entry, bdlPlayer: match ?? null };
    });

    const searchResults = await runConcurrent(searchTasks, 2, 1200);

    // Map: "TeamName|FirstLast" → bdlPlayerId
    const resolvedIds: Array<{ teamName: string; first: string; last: string; position: string; bdlId: number }> = [];
    for (const { entry, bdlPlayer } of searchResults) {
      if (bdlPlayer) {
        resolvedIds.push({ ...entry, bdlId: Number(bdlPlayer.id) });
      } else {
        log(`  WARNING: Could not find BDL player for "${entry.first} ${entry.last}" (${entry.teamName})`);
      }
    }
    log(`Resolved ${resolvedIds.length}/${allEntries.length} players via BDL search`);

    // ── Step 2: Fetch season averages — two clean passes ─────────────────────
    // Pass A: current season (2025-26). Pass B: fallback to 2024-25 only for
    // players with no 2025 data. Two separate passes avoids the 2-serial-calls-
    // per-task pattern that doubled the API rate and caused burst rate limiting.
    // Concurrency=2, 1200ms gap → stable ~100 req/min across both passes.
    log('Fetching 2025-26 season averages (pass A)...');
    const statsMap = new Map<number, any>(); // bdlId → stats row

    const passATasks = resolvedIds.map(p => async () => {
      const json = await bdlGet(`/season_averages?season=2025&player_id=${p.bdlId}`);
      const row = json?.data?.[0] ?? null;
      if (row) statsMap.set(p.bdlId, row);
      return { bdlId: p.bdlId, found: !!row };
    });
    await runConcurrent(passATasks, 2, 1200);
    log(`Pass A: ${statsMap.size}/${resolvedIds.length} players have 2025-26 stats`);

    // Pass B: only for players missing 2025 stats
    const needFallback = resolvedIds.filter(p => !statsMap.has(p.bdlId));
    if (needFallback.length > 0) {
      log(`Fetching 2024-25 fallback for ${needFallback.length} players (pass B)...`);
      const passBTasks = needFallback.map(p => async () => {
        const json = await bdlGet(`/season_averages?season=2024&player_id=${p.bdlId}`);
        const row = json?.data?.[0] ?? null;
        if (row) statsMap.set(p.bdlId, row);
        return { bdlId: p.bdlId, found: !!row };
      });
      await runConcurrent(passBTasks, 2, 1200);
    }

    const statResults = resolvedIds.map(p => ({ p, stats: statsMap.get(p.bdlId) ?? null }));
    log(`Got stats for ${statResults.filter(r => r.stats).length}/${resolvedIds.length} players`);

    // ── Step 3: Build per-team entries ────────────────────────────────────────
    type PlayerEntry = {
      bdlPlayerId: number; name: string; position: string; teamName: string;
      mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number;
    };

    const byTeam = new Map<string, PlayerEntry[]>();
    for (const teamName of Object.keys(TEAM_PLAYERS)) byTeam.set(teamName, []);

    for (const { p, stats } of statResults) {
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

      const arr = byTeam.get(p.teamName);
      if (arr) {
        arr.push({
          bdlPlayerId: p.bdlId,
          name:      `${p.first} ${p.last}`,
          position:  p.position,
          teamName:  p.teamName,
          mpg, ppg, apg, rpg,
          eff: parseFloat(effRaw.toFixed(1)), gp,
        });
      }
    }

    // ── Fallback stats for players BDL resolved but has no season averages ────
    // The real bdlId is pulled from resolvedIds so live price syncs still work.
    // Only injected if the player isn't already present from live data.
    type StatFallback = { name: string; position: string; mpg: number; ppg: number; apg: number; rpg: number; eff: number; gp: number };
    const STAT_FALLBACKS: StatFallback[] = [
      // Jabari Smith Jr. — BDL ID resolves fine but no current season stats
      { name: 'Jabari Smith', position: 'PF', mpg: 27.0, ppg: 14.5, apg: 1.2, rpg: 7.4, eff: 12.8, gp: 62 },
      // VJ Edgecombe — rookie, may not have BDL stats yet
      { name: 'VJ Edgecombe', position: 'SG', mpg: 18.0, ppg: 8.5, apg: 1.5, rpg: 2.8, eff: 7.0, gp: 40 },
      // Moussa Diabaté — limited role, may lack BDL stats
      { name: 'Moussa Diabaté', position: 'C', mpg: 16.0, ppg: 6.5, apg: 0.8, rpg: 5.2, eff: 6.8, gp: 45 },
    ];

    for (const fb of STAT_FALLBACKS) {
      const resolved = resolvedIds.find(p => `${p.first} ${p.last}`.toLowerCase() === fb.name.toLowerCase());
      if (!resolved) continue;
      const arr = byTeam.get(resolved.teamName) ?? [];
      if (!arr.some(p => p.name.toLowerCase() === fb.name.toLowerCase())) {
        arr.push({ bdlPlayerId: resolved.bdlId, name: fb.name, position: fb.position, teamName: resolved.teamName, mpg: fb.mpg, ppg: fb.ppg, apg: fb.apg, rpg: fb.rpg, eff: fb.eff, gp: fb.gp });
        byTeam.set(resolved.teamName, arr);
        log(`  [fallback] Injected ${fb.name} (bdlId=${resolved.bdlId}) for ${resolved.teamName}`);
      }
    }

    // Sort each team by MPG desc, take top 5
    const finalPlayers: PlayerEntry[] = [];
    const teamBreakdown: Record<string, string[]> = {};

    for (const [teamName, players] of byTeam) {
      players.sort((a, b) => b.mpg - a.mpg || b.ppg - a.ppg);
      const top5 = players.slice(0, 5);
      byTeam.set(teamName, top5);
      finalPlayers.push(...top5);
      teamBreakdown[teamName] = top5.map(p => `${p.name} (${p.mpg.toFixed(1)}mpg, ${p.ppg}ppg)`);
      log(`[${teamName}] ${top5.length} players: ${top5.map(p => p.name).join(', ')}`);
      if (top5.length < 5) log(`  ⚠ Only ${top5.length} qualified players`);
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

    const expectedTeams = Object.keys(TEAM_PLAYERS).length;
    const expectedTotal = expectedTeams * 5;
    const badTeams = Object.entries(teamCountMap).filter(([, c]) => c !== 5);
    if (totalCount === expectedTotal && badTeams.length === 0) {
      log(`✓ Laksh player universe successfully rebuilt: ${expectedTotal} players, ${expectedTeams} teams × 5 each.`);
    } else {
      log(`⚠ Done. Total: ${totalCount}. Issues: ${badTeams.map(([t, c]) => `${t}:${c}`).join(', ') || 'none'}`);
    }

    return NextResponse.json({
      success: true,
      total_inserted: totalCount,
      team_breakdown: teamBreakdown,
      team_counts: teamCountMap,
      validation_ok: totalCount === expectedTotal && badTeams.length === 0,
      logs,
    });

  } catch (err: any) {
    log(`ERROR: ${err.message}`);
    console.error('[rebuild-players] Fatal error:', err);
    return NextResponse.json({ success: false, error: err.message, logs }, { status: 500 });
  }
}
