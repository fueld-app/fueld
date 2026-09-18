-- Increase cost/sell price precision from 4 to 7 decimals (Riviera Marine broker
-- parity, e.g. SELL 1.2389848 EUR/LT). numeric(12,4) silently rounded on write.
-- ⚠️ DO NOT DOWNGRADE: altering back to (12,4) silently rounds and destroys 7dp data.
-- ⚠️ Scale change forces a full table rewrite under ACCESS EXCLUSIVE — deploy low-traffic.
ALTER TABLE order_items ALTER COLUMN cost_price    TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN sales_price   TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN profit        TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN cost_premium  TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN cost_barging  TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN sales_premium TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN sales_barging TYPE numeric(14, 7);
ALTER TABLE order_items ALTER COLUMN commission_per_unit TYPE numeric(14, 7);
