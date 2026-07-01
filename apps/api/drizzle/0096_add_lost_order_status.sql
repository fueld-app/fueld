-- Add LOST status to order_status enum for cancelled/lost inquiries
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'LOST';