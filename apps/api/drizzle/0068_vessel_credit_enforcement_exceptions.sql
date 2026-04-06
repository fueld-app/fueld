ALTER TABLE vessels
ADD COLUMN IF NOT EXISTS ignore_for_credit_enforcement boolean NOT NULL DEFAULT false;