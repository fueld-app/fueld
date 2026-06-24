--  0094_company_kyc_dates
--
--  Adds manual KYC tracking dates to counterparties (external suppliers/clients):
--    kyc_verified_date  — when KYC was last completed (null = not yet verified)
--    kyc_expiry_date     — when KYC expires and is due for renewal (null = no expiry)
--  Informational only; no order/trade blocking. Both columns nullable.

ALTER TABLE "counterparties"
  ADD COLUMN IF NOT EXISTS "kyc_verified_date" date,
  ADD COLUMN IF NOT EXISTS "kyc_expiry_date" date;