-- ════════════════════════════════════════════════════════════════════
--  0076_add_light_role
--
--  Adds LIGHT role to the role enum for users who can view orders
--  and paperwork but cannot see prices.
-- ════════════════════════════════════════════════════════════════════

ALTER TYPE role ADD VALUE IF NOT EXISTS 'LIGHT';
