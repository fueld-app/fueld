ALTER TABLE supplier_inquiries
  ADD COLUMN response_deadline_at timestamptz,
  ADD COLUMN reminder_sent_at timestamptz,
  ADD COLUMN reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN quote_valid_until timestamptz,
  ADD COLUMN delivery_window text,
  ADD COLUMN supplier_payment_terms text,
  ADD COLUMN supplier_comment text;

--> statement-breakpoint

ALTER TABLE supplier_inquiry_item_quotes
  ALTER COLUMN price DROP NOT NULL;

--> statement-breakpoint

ALTER TABLE supplier_inquiry_item_quotes
  ADD COLUMN note text;