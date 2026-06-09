-- Migration: add user_teams join table for many-to-many team membership
-- Previous: 0080_catalog_and_tax.sql

-- Create the join table
CREATE TABLE IF NOT EXISTS "user_teams" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  PRIMARY KEY ("user_id", "team_id")
);

-- Migrate existing team memberships from users.team_id into user_teams
INSERT INTO "user_teams" ("user_id", "team_id")
SELECT "id", "team_id" FROM "users" WHERE "team_id" IS NOT NULL
ON CONFLICT ("user_id", "team_id") DO NOTHING;

-- Rename users.team_id to primary_team_id for backward compatibility
ALTER TABLE "users" RENAME COLUMN "team_id" TO "primary_team_id";
