-- Add commission_per_unit to order_items for per-line-item broker commission
ALTER TABLE order_items ADD COLUMN commission_per_unit numeric(12, 4);