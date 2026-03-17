ALTER TABLE entity_comments ADD COLUMN follow_up_date date;
ALTER TABLE entity_comments ADD COLUMN follow_up_completed boolean NOT NULL DEFAULT false;
