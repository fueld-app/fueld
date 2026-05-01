ALTER TABLE supplier_inquiries
ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT false;