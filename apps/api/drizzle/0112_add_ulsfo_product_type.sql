-- Add ULSFO to product_type enum
ALTER TYPE "public"."product_type" ADD VALUE IF NOT EXISTS 'ULSFO';--> statement-breakpoint