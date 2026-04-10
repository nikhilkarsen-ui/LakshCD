export interface Player {
  id: string; name: string; team: string; position: string;
  current_price: number; previous_price: number;
  price_change_24h: number; price_change_pct_24h: number;

  // Pricing engine v3 fields
  fair_value: number;             // oracle FV with Bayesian shrinkage + availability discount
  twap_price: number;             // 30-min TWAP
  twap_30m: number;               // alias for twap_price
  market_depth: number;           // virtual liquidity depth in USD
  blend_w_amm: number;            // last tick blend weight: AMM (typically ~15%)
  blend_w_fv: number;             // last tick blend weight: FV  (typically ~65%)
  blend_w_twap: number;           // last tick blend weight: TWAP (typically ~20%)
  volume_24h: number;             // rolling 24h trade volume in USD
  last_trade_at: string | null;   // timestamp of last completed trade
  last_fee_rate: number;          // dynamic fee rate on last trade
  prior_fv_score: number | null;  // player-specific Bayesian prior (0–1)
  momentum_breaker_active: boolean;     // true if buying is paused
  momentum_breaker_until: string | null; // ISO timestamp when breaker expires

  // Legacy / kept in sync
  expected_value: number;         // raw EV score 0–1000
  expected_final_value: number;   // same as fair_value
  volatility: number;

  // Stats
  ppg: number; apg: number; rpg: number; efficiency: number; games_played: number;

  // AMM pools
  pool_x: number; pool_y: number;

  // Settlement
  is_active: boolean;
  final_settlement_price: number | null;
  settlement_status: 'active' | 'settled';

  // Live game boost
  live_game_boost: number;
  live_boost_expires_at: string | null;
  live_stats_snapshot: { game_id: number; pts: number; ast: number; reb: number; stl: number; blk: number; tov: number } | null;

  created_at: string; updated_at: string;
}

// Spot share ownership — no short positions, shares_owned always >= 0
export interface Position {
  id: string;
  user_id: string;
  player_id: string;
  shares_owned: number;       // always >= 0
  avg_cost_basis: number;     // weighted average purchase price per share
  realized_pnl: number;       // cumulative realized P&L from all past sells
  created_at: string;
  updated_at: string;
  player?: Player;
}

export interface Trade {
  id: string;
  user_id: string;
  player_id: string;
  side: 'buy' | 'sell' | 'settlement';
  shares: number;
  price: number;
  total_value: number;
  realized_pnl: number;
  created_at: string;
  player?: Pick<Player, 'id' | 'name' | 'team'>;
}

export interface PricePoint {
  id: string; player_id: string; price: number;
  expected_value: number; volatility: number;
  created_at: string;
}

export interface UserProfile {
  id: string; email: string; display_name: string;
  balance: number; initial_balance: number;
}

export interface LeaderboardEntry {
  user_id: string; display_name: string;
  portfolio_value: number; return_pct: number; num_trades: number;
}

// Portfolio is simple: cash + market value of holdings
export interface PortfolioData {
  total_value: number;
  cash_balance: number;
  holdings_value: number;   // sum of (shares_owned * current_price) across all positions
  unrealized_pnl: number;   // holdings_value - total_cost_basis
  realized_pnl: number;     // cumulative realized P&L from all sells
  total_pnl: number;        // unrealized + realized
  total_pnl_pct: number;
  positions: EnrichedPosition[];
}

export interface EnrichedPosition extends Position {
  current_price: number;
  market_value: number;       // shares_owned * current_price
  cost_basis: number;         // shares_owned * avg_cost_basis
  unrealized_pnl: number;     // market_value - cost_basis
  unrealized_pnl_pct: number;
}

export interface TradeRequest {
  player_id: string;
  side: 'buy' | 'sell';
  dollars: number;  // positive dollar amount (notional for sell, spend for buy)
  sell_all?: boolean; // if true, sell exact shares_owned regardless of dollars
}

export type ChartRange = '1D' | '1W' | '1M' | '3M' | 'ALL';
