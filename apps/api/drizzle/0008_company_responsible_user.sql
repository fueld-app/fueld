ALTER TABLE "counterparties"
ADD COLUMN "responsible_user_id" uuid REFERENCES "users"(id);
