-- ============================================================
-- LAKSH — Seed Realistic Price History
--
-- Run once to backfill synthetic historical price data so all
-- chart ranges (1D, 1W, 1M, 3M, ALL) show realistic curves
-- instead of empty charts.
--
-- Generates hourly data points for the past 90 days per player
-- using a mean-reverting random walk anchored to fair_value.
-- (~2,160 rows per player — fine for Supabase free tier)
--
-- Safe to re-run: skips players that already have >100 historical rows.
-- ============================================================

DO $$
DECLARE
  rec         RECORD;
  price       DECIMAL(10,2);
  prev_price  DECIMAL(10,2);
  ts          TIMESTAMPTZ;
  step        DECIMAL;
  mean_rev    DECIMAL;
  noise       DECIMAL;
  start_price DECIMAL(10,2);
  row_count   INT;
BEGIN
  FOR rec IN
    SELECT id, fair_value, expected_value, volatility, current_price
    FROM players
    WHERE is_active = true
      AND settlement_status = 'active'
      AND fair_value IS NOT NULL
      AND fair_value > 0
    ORDER BY id
  LOOP
    -- Skip if already has historical data
    SELECT COUNT(*) INTO row_count
    FROM price_history
    WHERE player_id = rec.id
      AND created_at < NOW() - INTERVAL '1 day';

    IF row_count > 100 THEN
      RAISE NOTICE 'Skipping % — already has % historical rows', rec.id, row_count;
      CONTINUE;
    END IF;

    -- Start price 90 days ago: between 65–95% of current fair value
    -- Use fair_value fractional part as a deterministic seed for variety
    start_price := rec.fair_value * (0.65 + (rec.fair_value - FLOOR(rec.fair_value)) * 0.30 + 0.05);
    start_price := GREATEST(5.0, start_price);

    price := start_price;

    FOR ts IN
      SELECT generate_series(
        NOW() - INTERVAL '90 days',
        NOW() - INTERVAL '1 hour',
        INTERVAL '1 hour'
      )
    LOOP
      -- Mean reversion: pull price toward fair_value with strength 0.4% per hour
      mean_rev := 0.004 * (rec.fair_value - price);

      -- Random noise: ~0.6% per hour — realistic and smooth, not jagged
      noise := (random() - 0.495) * price * 0.006;

      -- Small upward drift early in the walk, convergence near end
      step := mean_rev + noise;

      price := GREATEST(5.0, ROUND((price + step)::NUMERIC, 2));

      INSERT INTO price_history (player_id, price, expected_value, volatility, created_at)
      VALUES (
        rec.id,
        price,
        rec.expected_value * (0.90 + random() * 0.20),
        GREATEST(0.005, COALESCE(rec.volatility, 0.02) * (0.5 + random())),
        ts
      );
    END LOOP;

    RAISE NOTICE 'Seeded history for player %: start=% end=% fv=%',
      rec.id, start_price, price, rec.fair_value;
  END LOOP;
END;
$$;
