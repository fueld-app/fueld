-- Per-user booking-email signature fields (Moxie request 2026-09-03):
-- auto signatures on Bunker Booking emails with per-user contact details.
-- phone column already exists; add skype + whatsapp.
ALTER TABLE users ADD COLUMN skype text;

--> statement-breakpoint

ALTER TABLE users ADD COLUMN whatsapp text;