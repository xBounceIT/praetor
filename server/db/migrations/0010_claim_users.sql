-- First-time-modeling migration for the users table (see db/README.md). All statements
-- are guarded with IF NOT EXISTS so this is a no-op on existing dev/prod DBs (which already
-- have users from schema.sql) while still bootstrapping a fresh DB cleanly.
--
-- The named UNIQUE constraint `users_username_unique` only applies to fresh DBs; existing
-- DBs were bootstrapped with the inline `username VARCHAR(100) UNIQUE NOT NULL` from
-- schema.sql, which already creates an unnamed unique constraint enforcing the same predicate.
--
-- The named FK constraint `users_role_fkey` (referencing roles) and the named CHECK
-- `users_employee_type_check` are already created via the `DO $$` blocks in schema.sql; the
-- TS schema deliberately omits both (the FK to roles is a deferred-backfill site, the CHECK
-- isn't expressed in the TS schema), so this migration doesn't need to add either.

CREATE TABLE IF NOT EXISTS "users" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(50) NOT NULL,
	"avatar_initials" varchar(5) NOT NULL,
	"cost_per_hour" numeric(10, 2) DEFAULT '0',
	"is_disabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"employee_type" varchar(20) DEFAULT 'app_user',
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
-- Carry-forward of the legacy `ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_type` from
-- schema.sql. Some pre-existing DBs were bootstrapped before `employee_type` was added, so the
-- CREATE TABLE IF NOT EXISTS above no-ops on them and would leave the column missing.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_type" varchar(20) DEFAULT 'app_user';
