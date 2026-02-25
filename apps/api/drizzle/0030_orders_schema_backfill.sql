DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_term_type') THEN
    CREATE TYPE "public"."payment_term_type" AS ENUM('CREDIT', 'COD', 'PREPAY');
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "bank_account_id" uuid,
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "customer_payment_term_type" "payment_term_type",
  ADD COLUMN IF NOT EXISTS "customer_credit_days" integer,
  ADD COLUMN IF NOT EXISTS "customer_note" text,
  ADD COLUMN IF NOT EXISTS "supplier_id" uuid,
  ADD COLUMN IF NOT EXISTS "supplier_payment_term_type" "payment_term_type",
  ADD COLUMN IF NOT EXISTS "supplier_credit_days" integer,
  ADD COLUMN IF NOT EXISTS "supplier_note" text,
  ADD COLUMN IF NOT EXISTS "customer_contact_id" uuid,
  ADD COLUMN IF NOT EXISTS "supplier_contact_id" uuid,
  ADD COLUMN IF NOT EXISTS "terms_and_conditions" text,
  ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_bank_account_id_bank_accounts_id_fk'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_bank_account_id_bank_accounts_id_fk"
      FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_supplier_id_counterparties_id_fk'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_supplier_id_counterparties_id_fk"
      FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_customer_contact_id_company_contacts_id_fk'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_customer_contact_id_company_contacts_id_fk"
      FOREIGN KEY ("customer_contact_id") REFERENCES "public"."company_contacts"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_supplier_contact_id_company_contacts_id_fk'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_supplier_contact_id_company_contacts_id_fk"
      FOREIGN KEY ("supplier_contact_id") REFERENCES "public"."company_contacts"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
