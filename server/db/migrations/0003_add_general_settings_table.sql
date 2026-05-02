-- First-time-modeling migration for the `general_settings` single-row config table (see
-- db/README.md). The table already exists in dev/prod from schema.sql; CREATE TABLE,
-- ADD CONSTRAINT, and INSERT are all guarded so this is a no-op on existing DBs while
-- bootstrapping a fresh DB cleanly. Same overall pattern as 0002_add_config_tables.sql.
--
--   * CREATE TABLE IF NOT EXISTS — table-creation guard.
--   * pg_constraint guard around ADD CONSTRAINT — re-adds the CHECK (id = 1) singleton
--     invariant from schema.sql on fresh DBs without colliding with the auto-named
--     constraint that already exists on dev/prod (matched by `contype = 'c'` rather than
--     by name because Postgres's auto-generated name for an inline column CHECK isn't
--     guaranteed across versions).
--
--     Note vs. 0002: `general_settings` has *additional* CHECKs in schema.sql beyond the
--     singleton (`start_of_week IN ('Monday','Sunday')`, `ai_provider IN (...)`). On every
--     realistic DB state — fresh from schema.sql or pre-seeded prod — all three CHECKs are
--     present together, so the "any CHECK exists" proxy still correctly treats the singleton
--     as already-present and skips. A future migration that drops one CHECK while leaving
--     others would defeat this guard and need explicit handling.
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
INSERT INTO "general_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
