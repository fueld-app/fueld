ALTER TABLE "counterparties" ADD COLUMN IF NOT EXISTS "preferred_invoicing_company_id" uuid REFERENCES "counterparties"("id");
