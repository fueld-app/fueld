-- Add intermediary bank field to bank_accounts
ALTER TABLE "bank_accounts"
ADD COLUMN IF NOT EXISTS "intermediary_bank" text;

-- Add VAT number to counterparties (for own companies shown on invoices)
ALTER TABLE "counterparties"
ADD COLUMN IF NOT EXISTS "vat_number" text;

-- Add fraud prevention text to counterparties (own companies — shown on invoices)
ALTER TABLE "counterparties"
ADD COLUMN IF NOT EXISTS "fraud_prevention_text" text;

-- Seed default fraud prevention text for existing own companies
UPDATE "counterparties"
SET "fraud_prevention_text" = 'IF YOU ARE ASKED TO PAY AN INVOICE TO A DIFFERENT ACCOUNT TO THE ONE YOU HAVE REGISTERED WITH US, PLEASE TELEPHONE THE RELEVANT TRADER IMMEDIATELY TO CONFIRM THIS CHANGE IS LEGITIMATE.
BE ADVISED THAT WE WILL NEVER ASK YOU PAY INTO ANOTHER BANK WITHOUT PROVIDING WRITTEN AND SIGNED ADVICE FROM OUR GROUP CHIEF FINANCIAL OFFICER / GROUP FINANCIAL CONTROLLER.'
WHERE "is_own_company" = true AND "fraud_prevention_text" IS NULL;
