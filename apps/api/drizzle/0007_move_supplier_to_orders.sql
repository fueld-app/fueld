ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_payment_term_type" payment_term_type;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_credit_days" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_note" text;

ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;

WITH ranked AS (
  SELECT
    order_id,
    supplier_id,
    supplier_payment_term_type,
    supplier_credit_days,
    supplier_note,
    ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at ASC) AS rn
  FROM order_items
  WHERE supplier_id IS NOT NULL
     OR supplier_payment_term_type IS NOT NULL
     OR supplier_credit_days IS NOT NULL
     OR supplier_note IS NOT NULL
)
UPDATE orders o
SET supplier_id = r.supplier_id,
    supplier_payment_term_type = r.supplier_payment_term_type,
    supplier_credit_days = r.supplier_credit_days,
    supplier_note = r.supplier_note
FROM ranked r
WHERE o.id = r.order_id AND r.rn = 1;

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_supplier_id_counterparties_id_fk";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "supplier_id";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "supplier_payment_term_type";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "supplier_credit_days";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "supplier_note";
