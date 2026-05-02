-- First-time-modeling migration for the `general_settings` single-row config table (see
-- db/README.md). The table already exists in dev/prod from schema.sql; CREATE TABLE,
-- ADD CONSTRAINT, and INSERT are all guarded so this is a no-op on existing DBs while
-- bootstrapping a fresh DB cleanly. Same overall pattern as 0002_add_config_tables.sql,
-- with extra CHECKs unique to this table.
--
--   * CREATE TABLE IF NOT EXISTS — table-creation guard.
--
--   * pg_constraint guard around the singleton CHECK (id = 1) — re-adds the invariant
--     from schema.sql on fresh DBs without colliding with the auto-named constraint that
--     already exists on dev/prod (matched by `contype = 'c'` rather than by name because
--     Postgres's auto-generated name for an inline column CHECK isn't guaranteed across
--     versions). The "any CHECK exists" proxy works on every realistic DB state — on
--     existing DBs all three CHECKs are present together so the guard skips; on
--     fresh-from-migration DBs the table starts with zero CHECKs so the guard fires
--     before the column-CHECK guards below add the others.
--
--   * pg_constraint guards around the column-level CHECKs (`start_of_week IN
--     ('Monday','Sunday')`, `ai_provider IN ('gemini','openrouter')`) — schema.sql carries
--     these CHECKs on the live tables (lines 697 and 1037-1044 respectively). Adding them
--     here lets a fresh-from-migration DB (one bootstrapped purely via Drizzle migrations
--     without first running schema.sql) enforce the same invariants as schema.sql-seeded
--     installs. Matched by joining `pg_attribute` against `pg_constraint.conkey` (the array
--     of columns referenced by each constraint) rather than by name (start_of_week's CHECK
--     is auto-named) or by `pg_get_constraintdef` substring (which would over-match a future
--     CHECK that merely mentions the column in a multi-column rule). The conkey-by-column
--     match correctly identifies whether the table already carries a CHECK constrained on
--     the specific column.
--
--   * INSERT … ON CONFLICT DO NOTHING — seeds the singleton id=1 row so the first PUT to
--     /general-settings succeeds; idempotent on existing DBs that already have the row
--     from schema.sql:717.

CREATE TABLE IF NOT EXISTS "general_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"currency" varchar(10) DEFAULT '€',
	"daily_limit" numeric(4, 2) DEFAULT '8.00',
	"start_of_week" varchar(10) DEFAULT 'Monday',
	"treat_saturday_as_holiday" boolean DEFAULT true,
	"enable_ai_reporting" boolean DEFAULT false,
	"gemini_api_key" varchar(255),
	"ai_provider" varchar(20) DEFAULT 'gemini',
	"openrouter_api_key" varchar(255),
	"gemini_model_id" varchar(255),
	"openrouter_model_id" varchar(255),
	"allow_weekend_selection" boolean DEFAULT true,
	"default_location" varchar(20) DEFAULT 'remote',
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON c.conrelid = t.oid
		JOIN pg_namespace n ON t.relnamespace = n.oid
		WHERE t.relname = 'general_settings' AND n.nspname = 'public' AND c.contype = 'c'
	) THEN
		ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_id_check" CHECK ("id" = 1);
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON c.conrelid = t.oid
		JOIN pg_namespace n ON t.relnamespace = n.oid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
		WHERE t.relname = 'general_settings' AND n.nspname = 'public' AND c.contype = 'c'
		AND a.attname = 'start_of_week'
	) THEN
		ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_start_of_week_check" CHECK ("start_of_week" IN ('Monday', 'Sunday'));
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON c.conrelid = t.oid
		JOIN pg_namespace n ON t.relnamespace = n.oid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
		WHERE t.relname = 'general_settings' AND n.nspname = 'public' AND c.contype = 'c'
		AND a.attname = 'ai_provider'
	) THEN
		ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_ai_provider_check" CHECK ("ai_provider" IN ('gemini', 'openrouter'));
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "general_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
