-- Broker deal feature: flag orders as broker deals with commission tracking,
-- and add broker credit line flag to credit_lines.

ALTER TABLE orders ADD COLUMN is_broker_deal boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN commission_per_mt numeric(12, 4);

ALTER TABLE credit_lines ADD COLUMN is_broker_credit_line boolean NOT NULL DEFAULT false;