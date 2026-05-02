-- First-time-modeling migration for the work_units family (see db/README.md). All statements
-- are guarded with IF NOT EXISTS so this is a no-op on existing dev/prod DBs (which already
-- have these tables from schema.sql) while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "user_work_units" (
	"user_id" varchar(50) NOT NULL,
	"work_unit_id" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "user_work_units_user_id_work_unit_id_pk" PRIMARY KEY("user_id","work_unit_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_unit_managers" (
	"work_unit_id" varchar(50) NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "work_unit_managers_work_unit_id_user_id_pk" PRIMARY KEY("work_unit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_units" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_disabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
