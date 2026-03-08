-- Migration: supplier inquiry quote links and per-line item quotes

ALTER TABLE supplier_inquiries
ADD COLUMN IF NOT EXISTS quote_token_hash TEXT,
ADD COLUMN IF NOT EXISTS quote_token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS can_deliver BOOLEAN,
ADD COLUMN IF NOT EXISTS decline_reason TEXT;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inquiries_quote_token_hash
  ON supplier_inquiries(quote_token_hash)
  WHERE quote_token_hash IS NOT NULL;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS supplier_inquiry_item_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_inquiry_id UUID NOT NULL REFERENCES supplier_inquiries(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  price NUMERIC(12, 4) NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inquiry_item_quotes_unique
  ON supplier_inquiry_item_quotes(supplier_inquiry_id, order_item_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_supplier_inquiry_item_quotes_inquiry
  ON supplier_inquiry_item_quotes(supplier_inquiry_id);