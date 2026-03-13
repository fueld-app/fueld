-- Add per-order place remark (defaults to the place's order_remark on creation)
ALTER TABLE orders ADD COLUMN place_remark text;

-- Seed existing orders with their place's current default remark
UPDATE orders
SET place_remark = places.order_remark
FROM places
WHERE orders.place_id = places.id
  AND places.order_remark IS NOT NULL;
