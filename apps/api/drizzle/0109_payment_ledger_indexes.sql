-- Add indexes for per-counterparty payment ledger queries
-- Customer ledger: filter by customer_id, sort by received_at DESC
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_received_at
  ON customer_payments (customer_id, received_at DESC);

-- Supplier ledger: filter by supplier_id, sort by paid_at DESC
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_paid_at
  ON supplier_payments (supplier_id, paid_at DESC);