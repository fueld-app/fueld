-- Invoice numbering sequence + the one-invoice-per-order invariant
-- (Phase 0 of split payment terms).
--
-- Invoice numbers get their own per-tenant counter, separate from
-- order_number_sequences: a cancelled order must not burn an invoice number
-- and a voided invoice must not burn an order number. Order numbers are unique
-- per tenant in this DB; invoice_number already has a global UNIQUE constraint,
-- so the counter only has to be monotonic within one database.
--
-- Backfill: seed the counter from any invoices that already exist (only the
-- seed script and tests write them today, but a tenant that hand-imported rows
-- through psql must not collide with newly allocated numbers). Any number
-- ending in digits counts — the maximum is taken per tenant, so a stray
-- hand-written 'INV-TEST-0042' only ever pushes the counter forward, never
-- backwards, and cannot cause a collision. A production database with no
-- invoices inserts nothing and the counter starts at zero.
CREATE TABLE IF NOT EXISTS invoice_number_sequences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Cast via numeric so a pathological suffix (longer than bigint) cannot abort
-- the migration; anything implausible clamps to 0 rather than failing deploy.
INSERT INTO invoice_number_sequences (tenant_id, last_seq)
SELECT o.tenant_id, LEAST(COALESCE(MAX(s.seq), 0), 2147483647)::int
FROM invoices i
INNER JOIN orders o ON o.id = i.order_id
CROSS JOIN LATERAL (
  SELECT NULLIF(regexp_replace(i.invoice_number, '^.*?(\d+)$', '\1'), '')::numeric AS seq
  WHERE i.invoice_number ~ '\d+$'
) s
WHERE s.seq IS NOT NULL AND s.seq <= 2147483647
GROUP BY o.tenant_id
ON CONFLICT (tenant_id) DO NOTHING;
--> statement-breakpoint
-- Phase 0 issues exactly ONE live customer invoice per order. The application
-- enforces that by checking first, but concurrent issuance (two tabs, a
-- retried request, a double-click) could otherwise slip a second row past the
-- check. Enforce it in the database rather than relying on the check alone.
--
-- Partial on purpose: a VOID invoice must stay on file for audit yet release
-- the slot so a correction can be reissued for the same order. Phase 1 replaces
-- this with a per-tranche index when split terms arrive.
-- Drop-then-create: an earlier revision of this migration shipped the same
-- index WITHOUT the WHERE clause, and IF NOT EXISTS would silently keep it.
DROP INDEX IF EXISTS invoices_one_per_order;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_order
  ON invoices (order_id) WHERE status <> 'VOID';
