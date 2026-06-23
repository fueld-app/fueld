CREATE TABLE IF NOT EXISTS "vessel_persons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "vessel_id" uuid NOT NULL REFERENCES "vessels"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "title" text NOT NULL,
  "phone" text,
  "email" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_method" text;