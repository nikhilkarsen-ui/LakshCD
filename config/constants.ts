export const APP = { name: 'Laksh', tagline: 'The 24/7 Sports Exchange' } as const;
export const SEASON = { settlement_date: '2026-06-15T00:00:00Z', total_games: 82 } as const;
export const TRADE = { initial_balance: 10000, min_amount: 1, max_amount: 50000, fee_rate: 0.001, max_slippage: 0.05, amm_k: 5_000_000 } as const;
export const MARGIN = { initial: 0.50, maintenance: 0.25 } as const; // 50% IM, 25% MM
export const PRICING = {
  ev_w: 0.40, amm_w: 0.25, momentum_w: 0.15, vol_w: 0.20,
  reversion: 0.018, noise: 0.35, ema_alpha: 0.12, trend_window: 20, max_tick: 0.03,
  pts_w: 0.35, ast_w: 0.20, reb_w: 0.20, eff_w: 0.25,
  max_pts: 2800, max_ast: 900, max_reb: 1200, max_eff: 3000,
} as const;
export const POLL = { prices: 5000, portfolio: 6000, leaderboard: 30000 } as const;

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
