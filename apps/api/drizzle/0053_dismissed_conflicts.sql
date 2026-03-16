-- Track dismissed SeaSearcher conflicts per field (maps field → dismissed SS value)
ALTER TABLE "counterparties" ADD COLUMN IF NOT EXISTS "dismissed_conflicts" jsonb DEFAULT '{}'::jsonb;
