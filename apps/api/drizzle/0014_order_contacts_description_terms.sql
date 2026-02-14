-- Add contact person references and terms & conditions to orders
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "customer_contact_id" uuid REFERENCES "company_contacts"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "supplier_contact_id" uuid REFERENCES "company_contacts"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "terms_and_conditions" text;
--> statement-breakpoint
-- Add description field to order items
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "description" text;
