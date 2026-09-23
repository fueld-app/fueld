-- Split receipts (Phase 2): a receipt covering several invoices keeps its identity.
--
-- Phase 1 stores a payment that covers more than one invoice as one row per
-- invoice, because a row carries a single invoice_id. That conserves the money
-- but makes the receipt look like several: the order's payment list and the
-- company's payment ledger would show N phantom receipts for one bank credit.
--
-- This adds the link that restores the identity. The row the trader actually
-- recorded is the parent (split_parent_id IS NULL); each additional part points
-- at it. `ON DELETE CASCADE` is the important part: deleting the parent removes
-- its parts too, so a future payment edit/delete cannot silently un-conserve the
-- amount received. That is the whole reason the panel flagged this as a gate
-- before payment CRUD ships.
--
-- Additive and safe on live data: existing rows are ordinary single-invoice
-- payments, so every one of them is a parent with NULL here.
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS split_parent_id uuid;
--> statement-breakpoint
-- The constraint is added separately and guarded, because `ADD COLUMN IF NOT
-- EXISTS` silently ignores its REFERENCES clause when the column already exists.
-- A database that gained the column out-of-band (a hand-run psql, or the test
-- compat shim) would otherwise have the column with NO cascade, and the cascade
-- is the whole protection against un-conserving a split receipt.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_payments_split_parent_id_fkey'
      AND conrelid = 'customer_payments'::regclass
  ) THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_split_parent_id_fkey
      FOREIGN KEY (split_parent_id) REFERENCES customer_payments(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_payments_split_parent_idx
  ON customer_payments (split_parent_id);
