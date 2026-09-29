-- Supplier receipts: money coming IN from a supplier, as its own ledger.
--
-- ── Why this replaces the link on `supplier_payments` ──────────────────────
-- 0135 attached receipts to `supplier_payments` via `supplier_invoice_id`. That
-- table is the OUTBOUND ledger — "money we paid a supplier for fuel" — and
-- three readers sum it unconditionally:
--
--   orders.service.ts     listSupplierPayments
--   orders.service.ts     updateOrderSupplierAmountPaid  (leg paid_at / amount_paid)
--   company.service.ts    getSupplierPaymentLedger       (supplier outstanding)
--
-- A receipt from a supplier is parked on a supplier *leg*, so money coming IN
-- was counted as money we paid OUT: a leg could be marked paid for fuel on the
-- strength of commission the supplier sent us, and a supplier's outstanding
-- balance would be understated. 0135 worked around that by filtering every
-- reader on `supplier_invoice_id IS NULL` — one forgotten filter away from a
-- wrong number, in the same way a payer column on `invoices` would have been.
--
-- Direction belongs in the table, not in a WHERE clause. Receipts get their own
-- ledger and `supplier_payments` goes back to being purely outbound.
--
-- Safe to do as a straight swap: no receipts exist yet (`supplier_payments`
-- where `supplier_invoice_id` is not null = 0 rows), so there is nothing to
-- migrate and no link to preserve.

CREATE TABLE supplier_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The invoice this receipt settled.
  --
  -- NULLABLE, `ON DELETE SET NULL`, and NOT deleted when an invoice is VOIDED:
  -- a receipt records cash that actually moved. Destroying it on void leaves a
  -- reissued invoice starting at zero while the money is real, with no trail —
  -- the operator re-keys or invents a row. A voided invoice keeps showing what
  -- was received against it, and the status derivation keeps it VOID regardless.
  supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  supplier_id uuid NOT NULL REFERENCES counterparties(id),
  -- The supplier leg the invoice's commission arose on, when there is one. Kept
  -- for context and reporting; the receipt does NOT contribute to that leg's
  -- paid amount, which is what went wrong when this lived on supplier_payments.
  order_supplier_id uuid REFERENCES order_suppliers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,

  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  -- Enforced in the table, not only in the app: the same argument that moved
  -- direction out of a WHERE clause. A zero or negative receipt is not a receipt.
  CONSTRAINT supplier_receipts_amount_positive CHECK (amount > 0),
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  method text,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX supplier_receipts_invoice_idx
  ON supplier_receipts (supplier_invoice_id);

CREATE INDEX supplier_receipts_tenant_supplier_idx
  ON supplier_receipts (tenant_id, supplier_id);

-- `supplier_payments` is the OUTBOUND ledger again.
ALTER TABLE supplier_payments
  DROP COLUMN IF EXISTS supplier_invoice_id;
