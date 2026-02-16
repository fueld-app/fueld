ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'orders_bank_account_id_bank_accounts_id_fk'
	) THEN
		ALTER TABLE "orders"
			ADD CONSTRAINT "orders_bank_account_id_bank_accounts_id_fk"
			FOREIGN KEY ("bank_account_id")
			REFERENCES "bank_accounts"("id")
			ON DELETE set null
			ON UPDATE no action;
	END IF;
END $$;
