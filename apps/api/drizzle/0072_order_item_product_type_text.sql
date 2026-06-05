ALTER TABLE "order_items"
ALTER COLUMN "product_type" TYPE text USING "product_type"::text;
