-- Add hide_on_documents flag to order_items for hiding broker commission
-- line items from customer-facing documents (confirmations, nominations, etc.)

ALTER TABLE order_items ADD COLUMN hide_on_documents boolean NOT NULL DEFAULT false;