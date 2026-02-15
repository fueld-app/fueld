ALTER TABLE "orders" ADD COLUMN "bank_account_id" uuid;
ALTER TABLE "orders" ADD CONSTRAINT "orders_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE set null ON UPDATE no action;
