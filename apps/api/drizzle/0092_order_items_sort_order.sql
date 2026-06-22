ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;

-- Backfill sort_order so existing rows keep their current order within each
-- order (deterministic by created_at, then id). New saves assign an explicit
-- sequential sort_order from the frontend row order.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY order_id ORDER BY created_at, id) - 1 AS rn
  FROM order_items
)
UPDATE order_items SET sort_order = ordered.rn
FROM ordered WHERE order_items.id = ordered.id;