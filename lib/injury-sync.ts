// ============================================================
// LAKSH — Injury Sync
//
// Fetches the current NBA injury report from BallDontLie and
// writes injury_status / injury_description to the players table.
//
// Called once per day from /api/stats/sync (Vercel cron 6am UTC).
//
// Injury discount model (applied in pricing-v3 computeFairValue):
//
//   Out For Season / Suspended → ×0.30  (effectively 70% discount)
//   Out                        → ×0.60
//   Doubtful                   → ×0.80
//   Questionable               → ×0.90
//   Day-To-Day                 → ×0.95
//   Probable                   → ×0.98
//   healthy (NULL)             → ×1.00
//
// BDL injury statuses are normalised to these canonical strings so
// the pricing engine can do a simple switch.
// ============================================================

import { serverSupa } from './supabase';
import { fetchInjuries } from './bdl-client';

type InjuryStatus =
  | 'Out For Season'
  | 'Suspended'
  | 'Out'
  | 'Doubtful'
  | 'Questionable'
  | 'Day-To-Day'
  | 'Probable'
  | null;

/** Map raw BDL status strings to our canonical set. */
function normaliseStatus(raw: string | null | undefined): InjuryStatus {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s.includes('season') || s.includes('year'))  return 'Out For Season';
  if (s.includes('suspend'))                         return 'Suspended';
  if (s === 'out')                                   return 'Out';
  if (s.includes('doubtful'))                        return 'Doubtful';
  if (s.includes('questionable'))                    return 'Questionable';
  if (s.includes('day-to-day') || s.includes('dtd')) return 'Day-To-Day';
  if (s.includes('probable'))                        return 'Probable';
  return 'Day-To-Day'; // unknown status → treat as minor
}

export interface InjurySyncResult {
  injured:  number;  // players set to an injury status
  cleared:  number;  // players whose injury was cleared (set to NULL)
  total:    number;  // total players in DB
}

export async function syncInjuries(): Promise<InjurySyncResult> {
  const db = serverSupa();

  // 1. Load all our tracked players (need bdl_player_id to match)
  const { data: players, error } = await db
    .from('players')
    .select('id, injury_status')
    .eq('is_active', true);

  if (error || !players?.length) {
    return { injured: 0, cleared: 0, total: 0 };
  }

  // 2. Fetch the current injury report from BDL
  // fetchInjuries returns a Map<bdl_player_id, injuryRow>
  // We match by name since we may not store bdl_player_id on every player.
  // We also fetch the player names from BDL so we can cross-reference.
  const injuryMap = await fetchInjuries();

  // Build a name → injury map from BDL response
  // BDL format: { player: { first_name, last_name }, status, description }
  const byName = new Map<string, { status: InjuryStatus; description: string }>();
  for (const [, entry] of injuryMap) {
    const fullName = `${entry.player?.first_name ?? ''} ${entry.player?.last_name ?? ''}`.trim();
    if (fullName) {
      byName.set(fullName.toLowerCase(), {
        status:      normaliseStatus(entry.status),
        description: entry.description ?? '',
      });
    }
  }

  // 3. Load player names from DB for matching
  const { data: playerNames } = await db
    .from('players')
    .select('id, name, injury_status')
    .eq('is_active', true);

  if (!playerNames?.length) return { injured: 0, cleared: 0, total: 0 };

  const now     = new Date().toISOString();
  let injured   = 0;
  let cleared   = 0;

  for (const p of playerNames) {
    const match = byName.get(p.name.toLowerCase());

    if (match) {
      // Player appears on the injury report
      if (p.injury_status !== match.status) {
        await db.from('players').update({
          injury_status:      match.status,
          injury_description: match.description,
          injury_updated_at:  now,
        }).eq('id', p.id);
      }
      injured++;
    } else if (p.injury_status !== null) {
      // Player was injured but no longer on the report → clear
      await db.from('players').update({
        injury_status:      null,
        injury_description: null,
        injury_updated_at:  now,
      }).eq('id', p.id);
      cleared++;
    }
  }

  return { injured, cleared, total: playerNames.length };
}

/** Discount multiplier to apply to fair value based on injury status. */
export function injuryDiscount(status: string | null | undefined): number {
  switch (status) {
    case 'Out For Season': return 0.30;
    case 'Suspended':      return 0.30;
    case 'Out':            return 0.60;
    case 'Doubtful':       return 0.80;
    case 'Questionable':   return 0.90;
    case 'Day-To-Day':     return 0.95;
    case 'Probable':       return 0.98;
    default:               return 1.00;
  }
}
