-- WhatsApp linked-device sessions (Baileys auth state)
CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL REFERENCES "users"("id") UNIQUE,
  "creds"         jsonb,
  "synced_at"     timestamptz,
  "phone_number"  text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "whatsapp_keys" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"   uuid NOT NULL REFERENCES "users"("id"),
  "key_type"  text NOT NULL,
  "key_id"    text NOT NULL,
  "key_data"  jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "whatsapp_keys_user_type_idx"
  ON "whatsapp_keys" ("user_id", "key_type");
