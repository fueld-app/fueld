CREATE TABLE IF NOT EXISTS "order_number_sequences" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'order_number_sequences_tenant_id_tenants_id_fk'
	) THEN
		ALTER TABLE "order_number_sequences"
			ADD CONSTRAINT "order_number_sequences_tenant_id_tenants_id_fk"
			FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_number" text;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'orders_order_number_unique'
	) THEN
		ALTER TABLE "orders"
			ADD CONSTRAINT "orders_order_number_unique" UNIQUE ("order_number");
	END IF;
END $$;
