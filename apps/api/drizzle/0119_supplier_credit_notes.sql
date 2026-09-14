-- Supplier credit notes (Phase 2 of credit-note support, panel-reviewed):
-- Money back from a supplier on an order supplier leg. Amounts stored
-- POSITIVE (direction implicit); received credits are amount-immutable
-- (cancel + reissue); void = cancelled, never deleted (audit).

DO $$ BEGIN
  CREATE TYPE supplier_credit_note_status AS ENUM ('EXPECTED', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE supplier_credit_note_reason AS ENUM ('PRICE_CORRECTION', 'QUANTITY_SHORTAGE', 'QUALITY_CLAIM', 'REBATE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_supplier_id uuid NOT NULL REFERENCES order_suppliers(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES counterparties(id),
  order_line_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  supplier_reference text,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  fx_rate numeric(14, 8),
  amount_in_order_currency numeric(14, 2),
  credit_date timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  status supplier_credit_note_status NOT NULL DEFAULT 'EXPECTED',
  reason supplier_credit_note_reason NOT NULL DEFAULT 'OTHER',
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_order ON supplier_credit_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_leg ON supplier_credit_notes(order_supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_tenant ON supplier_credit_notes(tenant_id);