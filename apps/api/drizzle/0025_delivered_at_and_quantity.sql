-- Add delivery tracking fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS delivered_quantity numeric(12, 3);
