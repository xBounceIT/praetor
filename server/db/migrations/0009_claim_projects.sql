-- First-time-modeling migration for the projects table (see db/README.md). All statements
-- are guarded with IF NOT EXISTS so this is a no-op on existing dev/prod DBs (which already
-- have projects from schema.sql) while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "projects" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"color" varchar(20) DEFAULT '#3b82f6' NOT NULL,
	"description" text,
	"is_disabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"order_id" varchar(100)
);
--> statement-breakpoint
-- Carry-forward of the legacy `ALTER TABLE projects ADD COLUMN IF NOT EXISTS order_id` from
-- schema.sql. Some pre-existing DBs were bootstrapped before `order_id` was added inline,
-- so the CREATE TABLE IF NOT EXISTS above no-ops on them and would leave the column missing.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "order_id" varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_client_id" ON "projects" USING btree ("client_id");
