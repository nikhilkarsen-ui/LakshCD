-- LAKSH v2 Seed (FIXED) — Bug #7: AMM pools calibrated so spot_price = current_price
-- pool_x = liquidity_depth / price, pool_y = liquidity_depth
-- spot = pool_y / pool_x = price

INSERT INTO players (name, team, position, current_price, previous_price, expected_value, ppg, apg, rpg, efficiency, games_played, pool_x, pool_y)
VALUES
  ('LeBron James','Los Angeles Lakers','SF',284.52,282.30,720.50,25.8,8.3,7.5,28.1,60, 17584.27, 5003482.56),
  ('Stephen Curry','Golden State Warriors','PG',312.18,310.00,680.30,27.1,5.2,4.8,26.4,58, 16017.04, 5000039.95),
  ('Kevin Durant','Houston Rockets','PF',298.67,296.50,750.20,28.3,5.0,6.7,29.8,55, 16740.83, 5000863.85),
  ('Giannis Antetokounmpo','Milwaukee Bucks','PF',325.43,323.10,810.70,30.2,5.8,11.5,32.1,62, 15364.06, 4999996.48),
  ('Luka Dončić','Los Angeles Lakers','PG',289.91,287.60,790.40,29.5,9.1,8.8,30.5,57, 17242.59, 4999937.07),
  ('Ja Morant','Memphis Grizzlies','PG',245.30,243.80,620.10,24.8,8.1,5.3,23.9,52, 20383.20, 4999998.96),
  ('Jayson Tatum','Boston Celtics','SF',278.15,276.50,700.80,27.0,4.6,8.4,27.2,61, 17981.66, 5002112.78),
  ('Anthony Edwards','Minnesota Timberwolves','SG',268.42,266.90,670.30,26.5,5.3,5.8,25.8,63, 18627.49, 5001105.67),
  ('Shai Gilgeous-Alexander','Oklahoma City Thunder','PG',341.78,339.40,850.90,31.4,6.2,5.5,33.0,64, 14631.63, 5001010.51),
  ('Nikola Jokić','Denver Nuggets','C',352.10,349.70,880.50,26.3,9.8,12.4,34.2,62, 14202.50, 5001100.25),
  ('Victor Wembanyama','San Antonio Spurs','C',305.60,303.20,710.20,24.4,3.7,10.8,27.5,59, 16361.26, 4999171.06),
  ('Donovan Mitchell','Cleveland Cavaliers','SG',232.50,231.00,590.40,24.0,4.5,4.2,22.8,58, 21505.38, 4999999.35),
  ('Jalen Brunson','New York Knicks','PG',285.60,283.80,730.20,28.7,6.7,3.5,26.0,63, 17517.86, 5003101.10),
  ('Joel Embiid','Philadelphia 76ers','C',310.20,308.00,830.40,33.1,5.7,11.0,35.5,39, 16118.96, 5000494.91),
  ('Trae Young','San Antonio Spurs','PG',262.15,260.50,640.70,25.7,10.8,3.0,23.4,61, 19073.01, 4999982.47);

-- Generate 24hr price history
DO $$
DECLARE
  p RECORD;
  i INTEGER;
  ts TIMESTAMPTZ;
  base_price DECIMAL;
  cur_price DECIMAL;
  drift DECIMAL;
BEGIN
  FOR p IN SELECT id, current_price, volatility FROM players LOOP
    base_price := p.current_price;
    cur_price := base_price * 0.98;
    FOR i IN 1..288 LOOP
      ts := NOW() - ((288 - i) * INTERVAL '5 minutes');
      drift := (random() - 0.48) * base_price * COALESCE(p.volatility, 0.05) * 0.3;
      cur_price := cur_price + drift;
      cur_price := GREATEST(cur_price, base_price * 0.90);
      cur_price := LEAST(cur_price, base_price * 1.10);
      INSERT INTO price_history (player_id, price, expected_value, volatility, created_at)
      VALUES (p.id, ROUND(cur_price::numeric, 2), 500.00, COALESCE(p.volatility, 0.05), ts);
    END LOOP;
  END LOOP;
END $$;
