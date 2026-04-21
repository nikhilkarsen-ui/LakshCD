export const APP = { name: 'Laksh', tagline: 'The 24/7 Player Share Market' } as const;

// Season end = final settlement date for all remaining holdings
export const SEASON = { settlement_date: '2026-06-15T00:00:00Z', total_games: 82, start_date: '2025-10-01T00:00:00Z' } as const;

export const TRADE = { initial_balance: 10000, min_amount: 1, max_amount: 50000, fee_rate: 0.002, max_slippage: 0.12, amm_k: 5_000_000 } as const;

// ── Anti-Manipulation v2 ─────────────────────────────────────────────────────
export const ANTI_MANIP = {
  // Directional pressure: penalise users who consistently push price one way
  pressure_window_ms: 5 * 60_000,  // 5-minute rolling window
  max_pressure_dollars: 5_000,     // $5k net directional → max fill penalty
  max_fill_penalty: 0.08,          // worst fill is 8% worse than market price

  // Wash trade detection: flag if user round-trips within the window
  wash_window_ms: 5 * 60_000,
  wash_roundtrip_threshold: 0.80,  // 80% of volume is round-trip → suspicious
  wash_min_total: 200,             // only flag if window volume > $200
} as const;

// ── Pricing Engine v3 — Hardened ─────────────────────────────────────────────
export const PRICING_V3: Record<string, number> = {
  // ── Fair Value Oracle ──────────────────────────────────────────────────────
  pts_w: 0.35, ast_w: 0.20, reb_w: 0.20, eff_w: 0.25,
  max_pts: 2800, max_ast: 900, max_reb: 1200, max_eff: 3000,
  fv_scale: 0.40,
  min_price: 5,

  // Bayesian shrinkage with a realistic prior (not league average).
  // Prior is seeded per-player from constants; see SEED_PLAYERS.prior_fv_score.
  // Falls back to league_avg_score for unseeded players.
  credibility_games: 20,       // full credibility at 20 games (was 30)
  league_avg_score: 0.45,      // fallback only — player-specific priors preferred

  // Live boost: max ±15% FV shift. Increased from 10% so a monster game
  // can actually move the fair value anchor noticeably during play.
  live_boost_scale: 0.15,

  // ── Virtual Market Depth ──────────────────────────────────────────────────
  // Base depth is substantially higher to resist sybil attacks.
  base_depth: 80_000,               // $80k base (was $40k)
  depth_season_boost: 2.0,          // grows to $240k by season end
  depth_proximity_boost: 0.50,
  depth_proximity_decay: 0.12,
  depth_volume_base: 20_000,
  min_depth: 50_000,                // floor: $50k (was $20k)

  // ── Slippage ──────────────────────────────────────────────────────────────
  slippage_exponent: 2.0,           // was 1.5 — quadratic not 1.5-power
  max_price_impact_per_trade: 0.05, // was 8% — now capped at 5%
  // Circuit breaker: ±25% early season, tightens to ±8% at settlement
  // Widened from 15%/4% — beta seed prices are still calibrating against real stat-based FV
  max_fv_deviation_base: 0.25,
  max_fv_deviation_floor: 0.08,     // near settlement: ±8%
  fee_rate_base: 0.002,             // base fee 0.2%

  // ── Dynamic fee escalation ────────────────────────────────────────────────
  // fee = base × (1 + dev_multiplier × |price/FV - 1| + vol_multiplier × normalizedVol)
  fee_dev_multiplier: 3.0,          // 3× fee when price is 10% from FV
  fee_vol_multiplier: 2.0,          // 2× fee when vol is 2× target
  fee_cap: 0.05,                    // maximum fee: 5%

  // ── Price Blend Weights ───────────────────────────────────────────────────
  // AMM drives visible per-tick movement. FV anchors the fair price.
  w_amm_base:  0.20,   // reduced from 0.35 — less per-trade price impact on blended price
  w_fv_base:   0.60,   // increased from 0.45 — more oracle-dominant
  w_twap_base: 0.20,

  // ── Tick / Mean Reversion ─────────────────────────────────────────────────
  drift_base: 0.025,
  drift_season_boost: 0.50,
  deviation_boost_threshold: 0.08,
  deviation_boost_multiplier: 0.50,
  noise_scale: 0.15,                // reduced from 0.35 — less random noise per tick (~$3 on $300 at 1σ)
  noise_min_vol: 0.02,              // ~$2/tick on $300 player at 1σ
  noise_damp_decay: 0.15,
  max_tick: 0.015,                  // reduced from 0.03 — max 1.5% per tick = $4.50 on $300

  // ── Dynamic Weight Adjustments ───────────────────────────────────────────
  target_vol: 0.015,
  idle_halflife_ms: 300_000,        // 5-min half-life — AMM weight stays relevant longer
  avg_daily_volume: 50_000,
  // Volume bonus is REMOVED from weight shifting to AMM.
  // High volume no longer makes AMM more dominant.

  // ── Settlement Protection ────────────────────────────────────────────────
  settlement_protection_hours: 168,   // was 72 — full week of tightening
  settlement_anchor_hours: 336,       // was 168 — two-week FV ramp
  settlement_fv_boost: 0.50,          // was 0.35 — FV gets 50% boost near settlement

  // ── TWAP ──────────────────────────────────────────────────────────────────
  twap_window_ms: 30 * 60 * 1000,    // was 5 min — now 30 min
  settlement_twap_window_ms: 7 * 24 * 60 * 60 * 1000, // 7-day TWAP — nearly impossible to sustain manipulation
  vol_window: 30,

  // ── Momentum circuit breaker ─────────────────────────────────────────────
  // If price has risen >momentumThreshold% in the last momentumWindowMs,
  // buying is paused for momentumCooldownMs.
  momentum_window_ms: 30 * 60_000,   // look back 30 minutes
  momentum_threshold: 0.20,          // 20% rise triggers cooldown (was 8% — too sensitive with natural drift)
  momentum_cooldown_ms: 5 * 60_000,  // 5-minute buy cooldown (was 10 min)

  // ── Position concentration limit ─────────────────────────────────────────
  // No account can hold shares worth more than this fraction of total market cap.
  max_position_pct: 0.10,           // 10% of outstanding market cap per user
  min_float_shares: 500,            // skip concentration check until 500 shares are in circulation
};

// ── Anti-Manipulation v3 — Hardened ──────────────────────────────────────────
export const ANTI_MANIP_V3 = {
  // Exponentially decaying pressure — never fully resets
  // Pressure score = sum of: dollars × exp(-age_ms / halflife_ms) for each past trade
  pressure_halflife_ms: 30 * 60_000,     // 30-minute half-life (was 5-min hard reset)
  pressure_lookback_ms: 4 * 60 * 60_000, // look back 4 hours of trade history
  max_pressure_score: 15_000,            // $15k decayed pressure → max penalty
  max_fill_penalty: 0.05,                // max 5% fill penalty (was 12% — too punitive for normal users)

  // Wash trading: longer window + lower threshold
  wash_window_ms: 30 * 60_000,           // was 5 min — now 30 min
  wash_roundtrip_threshold: 0.70,        // was 80% — now 70%
  wash_min_total: 500,

  // Trade velocity throttle: per user per player
  velocity_window_ms: 5 * 60_000,        // 5-minute window
  max_trades_in_window: 3,               // max 3 trades per player per 5 min
  velocity_cooldown_ms: 2 * 60_000,      // 2-minute cooldown after hitting limit

  // Dynamic fee distance from FV
  // Applied on top of base fee when price is away from FV
  deviation_fee_scale: 3.0,
} as const;

// ── No-Game Ornstein-Uhlenbeck Pricing ───────────────────────────────────────
// Used when no NBA game is in progress. Keeps prices alive without creating
// exploitable drift or large jumps.
//
// Model: P(t+1) = P(t) + α·(FV - P(t)) + σ_eff · Z_clamped
//
// Anti-exploitation proof:
//   At α=0.004, a $10 deviation on $200 player = $0.04/tick drift.
//   Noise is $0.20/tick (5× larger than drift signal).
//   To profit from drift: need $0.04 × N ticks > fee.
//   Over N ticks, cumulative noise = ±$0.20×√N >> drift gain.
//   Drift is permanently below the fee + noise floor → non-exploitable.
export const NO_GAME_PRICING: Record<string, number> = {
  // ── O-U reversion ──────────────────────────────────────────────────────────
  alpha_base: 0.004,          // reversion speed/tick; half-life = ln(2)/0.004 ≈ 14 min
  alpha_max:  0.012,          // ceiling — prevents runaway convergence near settlement

  // ── Noise ──────────────────────────────────────────────────────────────────
  sigma_base:  0.0010,        // relative σ/tick → $0.20 on $200 player (1σ)
  noise_clamp: 2.0,           // Z-score hard cap — eliminates fat tails entirely

  // ── Per-tick cap ───────────────────────────────────────────────────────────
  max_tick_pct: 0.0025,       // absolute max move: 0.25%/tick = $0.50 on $200

  // ── Game proximity: σ scales up as next game approaches ───────────────────
  // Rationale: pre-game anticipation raises real-world bid-ask spreads.
  proximity_window_hours: 8,  // start scaling up σ within 8h of next game
  proximity_boost_max:    1.6,// σ peaks at 1.6× base in the hour before tip-off

  // ── Liquidity dampening: high-volume players move less ────────────────────
  // High liquidity → efficient price → less noise needed to feel "alive"
  liquidity_base: 50_000,     // $50k/day = neutral; above this, noise damps down

  // ── Settlement convergence ─────────────────────────────────────────────────
  // Within 48h of settlement, ramp alpha up so price locks onto FV
  settlement_ramp_hours: 48,
  settlement_alpha_mult: 3.0, // alpha up to 3× base in final 48h
};

// Per-event price impact as a fraction of current_price.
// Applied multiplicatively for each new stat event detected since last snapshot.
// e.g. pts: 0.0006 → each new point scored moves price +0.06%.
// A 30-pt game (if polled infrequently, all 30 detected at once) = +1.8%.
// Turnover penalty is intentionally < 1 point of scoring so that a player
// who scores 2pts but turns it over is still net-positive on the tick.
export const LIVE_STATS = {
  pts:  +0.0006,   // +0.06% per point  (was 0.04%)
  ast:  +0.0008,   // +0.08% per assist (was 0.06%)
  reb:  +0.0003,   // +0.03% per rebound (was 0.025%)
  stl:  +0.0010,   // +0.10% per steal  (was 0.08%)
  blk:  +0.0008,   // +0.08% per block  (was 0.06%)
  tov:  -0.0005,   // -0.05% per turnover (was -0.10% — was 2.5× a point, now < 1 point)
} as const;

export const POLL = { prices: 5000, portfolio: 6000, leaderboard: 30000 } as const;

// Live game boost TTL — resets live_game_boost this long after the last stat event.
export const BOOST_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Parimutuel Pool ───────────────────────────────────────────────────────────
// All user deposits flow into a shared pool. At settlement, the distribution
// pool is divided proportionally by each user's portfolio mark-to-market value.
// Mid-season exits are allowed but incur an early exit fee that stays in the
// pool (benefiting remaining participants).
export const POOL = {
  season_key:      '2025-26',
  rake_rate:       0.05,   // 5%  — platform revenue on every deposit
  early_exit_fee:  0.03,   // 3%  — fee on mid-season NAV withdrawal; stays in pool
  min_deposit:     100,    // minimum deposit in dollars
} as const;

export const SEED_PLAYERS = [
  { name:'LeBron James',team:'Los Angeles Lakers',pos:'SF',ppg:25.8,apg:8.3,rpg:7.5,eff:28.1,gp:60,price:284.52 },
  { name:'Stephen Curry',team:'Golden State Warriors',pos:'PG',ppg:27.1,apg:5.2,rpg:4.8,eff:26.4,gp:58,price:312.18 },
  { name:'Kevin Durant',team:'Houston Rockets',pos:'PF',ppg:28.3,apg:5.0,rpg:6.7,eff:29.8,gp:55,price:298.67 },
  { name:'Giannis Antetokounmpo',team:'Milwaukee Bucks',pos:'PF',ppg:30.2,apg:5.8,rpg:11.5,eff:32.1,gp:62,price:325.43 },
  { name:'Luka Dončić',team:'Los Angeles Lakers',pos:'PG',ppg:29.5,apg:9.1,rpg:8.8,eff:30.5,gp:57,price:289.91 },
  { name:'Ja Morant',team:'Memphis Grizzlies',pos:'PG',ppg:24.8,apg:8.1,rpg:5.3,eff:23.9,gp:52,price:245.30 },
  { name:'Jayson Tatum',team:'Boston Celtics',pos:'SF',ppg:27.0,apg:4.6,rpg:8.4,eff:27.2,gp:61,price:278.15 },
  { name:'Anthony Edwards',team:'Minnesota Timberwolves',pos:'SG',ppg:26.5,apg:5.3,rpg:5.8,eff:25.8,gp:63,price:268.42 },
  { name:'Shai Gilgeous-Alexander',team:'Oklahoma City Thunder',pos:'PG',ppg:31.4,apg:6.2,rpg:5.5,eff:33.0,gp:64,price:341.78 },
  { name:'Nikola Jokić',team:'Denver Nuggets',pos:'C',ppg:26.3,apg:9.8,rpg:12.4,eff:34.2,gp:62,price:352.10 },
  { name:'Victor Wembanyama',team:'San Antonio Spurs',pos:'C',ppg:24.4,apg:3.7,rpg:10.8,eff:27.5,gp:59,price:305.60 },
  { name:'Donovan Mitchell',team:'Cleveland Cavaliers',pos:'SG',ppg:24.0,apg:4.5,rpg:4.2,eff:22.8,gp:58,price:232.50 },
  { name:'Jalen Brunson',team:'New York Knicks',pos:'PG',ppg:28.7,apg:6.7,rpg:3.5,eff:26.0,gp:63,price:285.60 },
  { name:'Joel Embiid',team:'Philadelphia 76ers',pos:'C',ppg:33.1,apg:5.7,rpg:11.0,eff:35.5,gp:39,price:310.20 },
  { name:'Trae Young',team:'San Antonio Spurs',pos:'PG',ppg:25.7,apg:10.8,rpg:3.0,eff:23.4,gp:61,price:262.15 },
];
