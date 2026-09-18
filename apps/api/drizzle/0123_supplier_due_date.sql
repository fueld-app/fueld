-- Supplier invoice due-date override (Riviera Marine request):
-- some suppliers grant credit from INVOICE RECEIPT rather than delivery,
-- and the system never knows when the supplier invoice was sent. Traders
-- can now pin the exact due date printed on the supplier's invoice.
-- supplier_due_date lives on order_suppliers (per supplier leg) and is
-- mirrored to orders (primary leg) like the other supplier payment-term
-- columns, so dashboard/reports financing keeps reading order-level data.
ALTER TABLE order_suppliers ADD COLUMN IF NOT EXISTS supplier_due_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_due_date date;