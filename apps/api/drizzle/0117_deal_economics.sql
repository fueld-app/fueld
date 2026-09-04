-- Deal economics (Riviera / Mario's workbook): per-deal commissions.
-- deal_type: SPOT / MILITARY / ... (trader vocabulary, free text)
-- tpc_per_mt + tpc_currency: third-party commission, money off-record, per MT
-- trader_commission_pct: trader's agreed commission, % of margin (sell-buy-tpc),
--   snapshot on the order (auto-filled from tenant traderCommissions config, editable)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deal_type text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tpc_per_mt numeric(12, 4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tpc_currency text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trader_commission_pct numeric(8, 4);
