-- Add parent/child hierarchy to counterparties (single-level only)
ALTER TABLE "counterparties" ADD COLUMN "parent_id" uuid REFERENCES "counterparties"("id") ON DELETE SET NULL;
CREATE INDEX "idx_counterparties_parent_id" ON "counterparties" ("parent_id");
