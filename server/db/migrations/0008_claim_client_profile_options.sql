-- First-time-modeling migration for the client_profile_options table (see db/README.md). All
-- statements are guarded with IF NOT EXISTS so this is a no-op on existing dev/prod DBs (which
-- already have the table from schema.sql) while still bootstrapping a fresh DB cleanly.
--
-- The named CHECK constraint `chk_client_profile_options_category` only applies to fresh DBs;
-- existing DBs were bootstrapped with an unnamed inline CHECK from schema.sql, which already
-- enforces the same predicate.

CREATE TABLE IF NOT EXISTS "client_profile_options" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"category" varchar(50) NOT NULL,
	"value" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_client_profile_options_category" CHECK ("client_profile_options"."category" IN ('sector', 'numberOfEmployees', 'revenue', 'officeCountRange'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_profile_options_category_value_unique" ON "client_profile_options" USING btree ("category",LOWER("value"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_client_profile_options_category_sort" ON "client_profile_options" USING btree ("category","sort_order","value");
