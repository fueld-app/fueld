ALTER TABLE "order_items"
  ADD COLUMN "cost_currency" text NOT NULL DEFAULT 'USD',
  ADD COLUMN "sales_currency" text NOT NULL DEFAULT 'USD';
