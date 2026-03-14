CREATE TABLE IF NOT EXISTS "company_offices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "counterparty_id" uuid NOT NULL REFERENCES "counterparties"("id") ON DELETE CASCADE,
  "city" text NOT NULL,
  "country" text,
  "country_code" text,
  "address" text,
  "phone" text,
  "email" text,
  "source" text NOT NULL DEFAULT 'manual',
  "seasearcher_office_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
