-- Migration: Change vessel_companies.role from enum to text for configurable roles
ALTER TABLE vessel_companies ALTER COLUMN role TYPE text;
