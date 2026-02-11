CREATE TABLE IF NOT EXISTS "customer_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "customer_id" uuid NOT NULL REFERENCES "counterparties"("id"),
  "order_id" uuid REFERENCES "orders"("id"),
  "invoice_id" uuid REFERENCES "invoices"("id"),
  "amount" numeric(14,2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "method" text,
  "note" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
