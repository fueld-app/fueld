-- Add missing transaction columns to bank_transactions
-- Migration 0110 was applied with fewer columns; this adds the rest.

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS debtor_account_iban text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS debtor_account_bban text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS debtor_agent text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS debtor_organisation_id text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS creditor_account_iban text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS creditor_account_bban text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS creditor_agent text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS creditor_organisation_id text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS remittance_info_structured text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_transaction_code text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_transaction_code_description text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS balance_after_amount numeric(14, 2);
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS balance_after_currency text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS entry_reference text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reference_number text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reference_number_schema text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS exchange_rate text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS merchant_category_code text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS transaction_date date;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS additional_info text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS resource_id text;