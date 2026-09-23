-- Split payment terms (Phase 1): a payment schedule per order, and the
-- per-tranche invoice invariant that replaces the Phase 0 one-invoice-per-order
-- index.
--
-- A deal paid "50% CIA and 50% at 21 dd" is two receivables with two due dates,
-- and the customer expects two invoices: one per tranche. Phase 0 issued exactly
-- one invoice per order, so this migration adds the schedule table, links each
-- invoice to the tranche it bills, and swaps the uniqueness rule.
--
-- Additive: an order with no schedule rows behaves exactly as before (a single
-- implicit 100% tranche on the order's own customer terms).

-- The enum must exist before the table that uses it. Guarded so a re-run is a
-- no-op (drizzle's runner tracks applied migrations, but a manual `psql -f`
-- must also be safe).
DO $$ BEGIN
  CREATE TYPE invoice_due_basis AS ENUM ('ON_ISSUE', 'FROM_DELIVERY', 'FIXED_DATE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS order_payment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  label text,
  -- Share of the order total. Rows of an order must sum to 100 (validated in
  -- the application: no constraint can express a cross-row sum).
  percent numeric(6,3) NOT NULL,
  due_basis invoice_due_basis NOT NULL DEFAULT 'FROM_DELIVERY',
  credit_days integer,
  fixed_due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS order_payment_schedule_order_seq_idx
  ON order_payment_schedule (order_id, seq);
--> statement-breakpoint
-- Which tranche each invoice bills, and the share it was billed at. Snapshotted
-- so re-editing the schedule cannot restate an invoice already sent.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS schedule_id uuid
  REFERENCES order_payment_schedule(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tranche_seq integer;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tranche_label text;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tranche_percent numeric(6,3);
--> statement-breakpoint
-- Swap the uniqueness rule: one LIVE invoice per (order, tranche) instead of one
-- per order. `coalesce(tranche_seq, 0)` lets a single index cover both a
-- scheduled order (seq >= 1) and an unscheduled one (tranche_seq NULL, which
-- must still collide with itself). Partial on status so voiding frees the slot.
--
-- Drop-then-create rather than IF NOT EXISTS: the Phase 0 index has a different
-- name (invoices_one_per_order) and must go, or split terms could never issue a
-- second invoice for the same order.
DROP INDEX IF EXISTS invoices_one_per_order;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_live_per_tranche
  ON invoices (order_id, coalesce(tranche_seq, 0)) WHERE status <> 'VOID';
