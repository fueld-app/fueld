-- Incoming RFQs (parsed from WhatsApp DMs or manual paste)
DO $$ BEGIN
  CREATE TYPE rfq_status AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS incoming_rfqs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),

  source text NOT NULL DEFAULT 'whatsapp',
  sender_phone text,
  sender_name text,
  raw_text text NOT NULL,

  vessel_name text,
  imo text,
  port text,
  products jsonb DEFAULT '[]',
  eta timestamptz,
  confidence double precision NOT NULL DEFAULT 0,

  status rfq_status NOT NULL DEFAULT 'PENDING',
  order_id uuid REFERENCES orders(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
