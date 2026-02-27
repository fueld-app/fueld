ALTER TABLE "order_attachments"
ALTER COLUMN "type" TYPE text
USING "type"::text;

ALTER TABLE "order_attachments"
ALTER COLUMN "type" SET DEFAULT 'OTHER';
