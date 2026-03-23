ALTER TABLE "company_contacts"
  ADD COLUMN IF NOT EXISTS "seasearcher_person_id" integer,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
