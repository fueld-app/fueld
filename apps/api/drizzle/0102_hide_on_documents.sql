-- Add hide_on_documents flag to order_items for hiding broker commission
-- line items from customer-facing documents (confirmations, nominations, etc.)

ALTER TABLE order_items ADD COLUMN hide_on_documents boolean NOT NULL DEFAULT false;

-- Add BROKER_CONFIRMATION to document_type enum for broker confirmation documents
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'BROKER_CONFIRMATION';