// ============================================================
// LAKSH — BallDontLie Stats Integration
// ============================================================
// Syncs real NBA season averages from api.balldontlie.io into
// the players table. The pricing engine's computeEV() reads
// ppg/apg/rpg/efficiency/games_played directly from the DB,
// so every update here immediately shifts fair-value targets
// and mean-reversion forces on the next price tick.
//
// Two-phase sync:
//   Phase 1 — ID mapping (one-time per player):
//     Search BDL by player name → store bdl_player_id in DB.
//     Unmapped players are retried on subsequent syncs.
//
//   Phase 2 — Stats fetch (runs every sync):
//     Single batched request for all players with known IDs.
//     Updates ppg, apg, rpg, efficiency, games_played.
//
// Rate limits:
//   Free tier  : 5 req/min  → set BDL_SEARCH_DELAY_MS=12000
//   All-Star   : 60 req/min → default delay (500ms) is fine
//   GOAT       : 600 req/min→ set BDL_SEARCH_DELAY_MS=100
//
// Required env var: BALLDONTLIE_API_KEY
// ============================================================

import { serverSupa } from './supabase';

const BDL_BASE = 'https://api.balldontlie.io/v1';
// Delay between player-name search requests (Phase 1 only, one-time).
// Override with BDL_SEARCH_DELAY_MS env var to match your rate-limit tier.
const SEARCH_DELAY_MS = parseInt(process.env.BDL_SEARCH_DELAY_MS || '500', 10);

function bdlHeaders(): Record<string, string> {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error('BALLDONTLIE_API_KEY env var is not set');
  return { Authorization: key };
}

// Strip accents/diacritics so "Dončić" → "Doncic" for BDL search
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// Search BDL for a player by their full display name.
// Returns the BDL numeric player ID, or null on miss.
async function findBDLId(fullName: string): Promise<number | null> {
  const parts = stripDiacritics(fullName).split(' ');
  // Use the last name (or last two words for multi-word surnames like Antetokounmpo)
  const lastName = parts.slice(1).join(' ');
  const url = `${BDL_BASE}/players?search=${encodeURIComponent(lastName)}&per_page=25`;

  const res = await fetch(url, { headers: bdlHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BDL player search ${res.status}: ${body}`);
  }

  const json = await res.json();
  const needle = stripDiacritics(fullName).toLowerCase();

  // Exact normalized full-name match
  const match = (json.data as any[])?.find(
    (p: any) => stripDiacritics(`${p.first_name} ${p.last_name}`).toLowerCase() === needle
  );

  return match?.id ?? null;
}

// NBA Efficiency = PTS + REB + AST + STL + BLK − (FGA−FGM) − (FTA−FTM) − TOV
// Mirrors the formula used by NBA.com for "EFF" box-score stat.
function computeEfficiency(s: any): number {
  const n = (v: any) => Number(v || 0);
  return (
    n(s.pts) + n(s.reb) + n(s.ast) + n(s.stl) + n(s.blk)
    - (n(s.fga) - n(s.fgm))
    - (n(s.fta) - n(s.ftm))
    - n(s.turnover)
  );
}

export interface SyncResult {
  updated: number;     // players whose stats were refreshed
  mapped: number;      // players whose BDL ID was found this run
  skipped: number;     // players with no BDL match yet
  errors: string[];
}

export async function syncStats(): Promise<SyncResult> {
  const db = serverSupa();
  const errors: string[] = [];
  let updated = 0;
  let mapped = 0;
  let skipped = 0;

  if (!process.env.BALLDONTLIE_API_KEY) {
    return { updated: 0, mapped: 0, skipped: 0, errors: ['BALLDONTLIE_API_KEY is not set'] };
  }

  // ── Phase 1: Map player names → BDL IDs ──────────────────────────────────
  const { data: players, error: playersErr } = await db
    .from('players')
    .select('id, name, bdl_player_id')
    .eq('is_active', true);

  if (playersErr || !players?.length) {
    return { updated: 0, mapped: 0, skipped: 0, errors: ['Failed to load players'] };
  }

  const unmapped = players.filter((p: any) => !p.bdl_player_id);

  for (const player of unmapped) {
    try {
      if (unmapped.indexOf(player) > 0) {
        // Rate-limit delay between search requests (skip before the first one)
        await new Promise(r => setTimeout(r, SEARCH_DELAY_MS));
      }

      const bdlId = await findBDLId(player.name);
      if (bdlId) {
        await db.from('players')
          .update({ bdl_player_id: bdlId, updated_at: new Date().toISOString() })
          .eq('id', player.id);
        player.bdl_player_id = bdlId;
        mapped++;
        console.log(`BDL MAP: ${player.name} → ID ${bdlId}`);
      } else {
        skipped++;
        errors.push(`No BDL match for "${player.name}"`);
      }
    } catch (e: any) {
      skipped++;
      errors.push(`ID lookup failed for "${player.name}": ${e.message}`);
    }
  }

  // ── Phase 2: Fetch season averages one player at a time ──────────────────
  // /season_averages only accepts a single player_id — no batch endpoint on this tier.
  const withIds = players.filter((p: any) => p.bdl_player_id);
  if (!withIds.length) {
    return { updated, mapped, skipped, errors };
  }

  const now = new Date().toISOString();

  for (const player of withIds) {
    try {
      if (withIds.indexOf(player) > 0) {
        await new Promise(r => setTimeout(r, SEARCH_DELAY_MS));
      }

      const url = `${BDL_BASE}/season_averages?season=2025&player_id=${player.bdl_player_id}`;
      const res = await fetch(url, { headers: bdlHeaders(), cache: 'no-store' });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        errors.push(`Stats fetch failed for "${player.name}" (${res.status}): ${body}`);
        continue;
      }

      const json = await res.json();
      const stats = (json.data as any[])?.[0];

      if (!stats) {
        errors.push(`No 2025 season stats for "${player.name}" (BDL ID: ${player.bdl_player_id})`);
        continue;
      }

      const eff = computeEfficiency(stats);
      await db.from('players').update({
        ppg:             parseFloat(Number(stats.pts       || 0).toFixed(1)),
        apg:             parseFloat(Number(stats.ast       || 0).toFixed(1)),
        rpg:             parseFloat(Number(stats.reb       || 0).toFixed(1)),
        efficiency:      parseFloat(eff.toFixed(1)),
        games_played:    Number(stats.games_played || 0),
        stats_synced_at: now,
        updated_at:      now,
      }).eq('id', player.id);

      updated++;
      console.log(
        `BDL SYNC: ${player.name} — ppg=${stats.pts} apg=${stats.ast} rpg=${stats.reb} ` +
        `eff=${eff.toFixed(1)} gp=${stats.games_played}`
      );
    } catch (e: any) {
      errors.push(`Stats error for "${player.name}": ${e.message}`);
    }
  }

  return { updated, mapped, skipped, errors };
}
