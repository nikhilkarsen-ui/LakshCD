export interface Player {
  id: string; name: string; team: string; position: string;
  current_price: number; previous_price: number;
  price_change_24h: number; price_change_pct_24h: number;
  expected_value: number; volatility: number;
  ppg: number; apg: number; rpg: number; efficiency: number;
  games_played: number; pool_x: number; pool_y: number;
  is_active: boolean; created_at: string; updated_at: string;
}

// Single position model: position_size positive=long, negative=short
export interface Position {
  id: string;
  user_id: string;
  player_id: string;
  position_size: number;    // +ve = long, -ve = short
  avg_entry_price: number;
  created_at: string;
  updated_at: string;
  player?: Player;
}

export interface Trade {
  id: string;
  user_id: string;
  player_id: string;
  size: number;             // signed: +ve = bought, -ve = sold/shorted
  price: number;
  pnl: number;
  created_at: string;
  player?: Player;
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

export interface MarginInfo {
  equity: number;
  total_notional: number;
  required_margin: number;       // 50% of notional
  maintenance_margin: number;    // 25% of notional
  margin_available: number;
  margin_usage_pct: number;
  health: 'safe' | 'warning' | 'liquidation';
}

export interface PortfolioData {
  total_value: number;
  cash_balance: number;
  positions_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  margin: MarginInfo;
  positions: EnrichedPosition[];
}

export interface EnrichedPosition extends Position {
  current_price: number;
  notional: number;
  pnl: number;
  pnl_pct: number;
  side: 'buy' | 'sell';
  liq_price: number;
  locked_margin: number;
}

export interface TradeRequest {
  player_id: string;
  dollars: number; // positive = go long / add long, negative = go short / add short
}

export type ChartRange = '1D' | '1W' | '1M' | '3M' | 'ALL';
