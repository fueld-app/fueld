-- Expand product_type enum with additional fuel and charge types
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'IFO380CST';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'IFO180CST';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'IFO120CST';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'IFO30CST';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'IFO';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'MDO';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'LSIFO';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'ITEM';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'COMMISSION';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'HIRE';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'PAYMENT';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'CUTTERSTOCK';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'PYGAS';--> statement-breakpoint
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'BARGING_FEE';--> statement-breakpoint
-- Migrate existing IFO380 data to IFO380CST
UPDATE "order_items" SET "product_type" = 'IFO380CST' WHERE "product_type" = 'IFO380';
