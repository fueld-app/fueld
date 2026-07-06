-- Two-sided order settlement: supplier-side payment tracking.
-- Adds supplier_payments table (mirrors customer_payments) and
-- settlement columns on order_suppliers (amount_paid / paid_at).

ALTER TABLE "order_suppliers"
  ADD COLUMN "amount_paid" numeric(14,2) DEFAULT '0';--> statement-breakpoint

ALTER TABLE "order_suppliers"
  ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_supplier_id" uuid NOT NULL REFERENCES "order_suppliers"("id") ON DELETE cascade,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE cascade,
  "supplier_id" uuid NOT NULL REFERENCES "counterparties"("id"),
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE set null,
  "amount" numeric(14,2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "paid_at" timestamp with time zone NOT NULL DEFAULT now(),
  "method" text,
  "note" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_supplier_payments_order_supplier_id"
  ON "supplier_payments" ("order_supplier_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_supplier_payments_order_id"
  ON "supplier_payments" ("order_id");