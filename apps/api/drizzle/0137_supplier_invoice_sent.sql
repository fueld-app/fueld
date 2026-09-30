-- Record that a supplier invoice has been sent.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- The send route exists so a payable is not silently never-sent — that was the
-- loss mode it was written to prevent. But the send produced no link back to the
-- invoice: `email_log` carries a nullable `order_id` and nothing else, and a
-- period invoice has no single order, so after sending there was no way to tell
-- from the invoice whether it had gone out, or to find payables that never did.
--
-- These columns are deliberately a SUMMARY, not a second log: `email_log` stays
-- the per-message record (recipients, channel, subject, errors). A resend
-- overwrites these, which is what an operator wants to see on the invoice — when
-- it last went out and to whom — while the full history lives in the log.
--
-- Nullable, with no backfill: nothing has been sent yet (zero invoices and zero
-- receipts in production when this lands), so there is no state to reconstruct.
ALTER TABLE supplier_invoices ADD COLUMN sent_at timestamptz;
ALTER TABLE supplier_invoices ADD COLUMN sent_to text;
