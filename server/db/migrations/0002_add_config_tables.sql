-- First-time-modeling migration for the single-row config tables (see db/README.md). Both
-- tables already exist in dev/prod from schema.sql; CREATE TABLE / ALTER / INSERT are all
-- guarded so this is a no-op on existing DBs while bootstrapping a fresh DB cleanly:
--   * CREATE TABLE IF NOT EXISTS — table-creation guard.
--   * pg_constraint guard around ADD CONSTRAINT — re-adds the CHECK (id = 1) singleton
--     invariant from schema.sql on fresh DBs without colliding with the auto-named
--     constraint that already exists on dev/prod (matched by `contype = 'c'` rather than by
--     name because Postgres's auto-generated name for an inline column CHECK isn't
--     guaranteed across versions). The guard treats "any CHECK constraint exists on the
--     table" as a proxy for "the singleton CHECK exists" — correct for these tables, which
--     only ever carry the singleton invariant. Adding any other CHECK to either table later
--     would require revisiting this guard.
--   * INSERT … ON CONFLICT DO NOTHING — seeds the singleton id=1 row so the first PUT to
--     /email/config and /ldap/config succeeds; idempotent on existing DBs that already
--     have the row from schema.sql.
-- Same overall pattern as 0000_baseline_pre_drizzle and 0001_add_phase3_tables.

CREATE TABLE IF NOT EXISTS "email_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false,
	"smtp_host" varchar(255) DEFAULT '',
	"smtp_port" integer DEFAULT 587,
	"smtp_encryption" varchar(20) DEFAULT 'tls',
	"smtp_reject_unauthorized" boolean DEFAULT true,
	"smtp_user" varchar(255) DEFAULT '',
	"smtp_password" varchar(255) DEFAULT '',
	"from_email" varchar(255) DEFAULT '',
	"from_name" varchar(255) DEFAULT 'Praetor',
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ldap_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false,
	"server_url" varchar(500) DEFAULT 'ldap://ldap.example.com:389',
	"base_dn" varchar(500) DEFAULT 'dc=example,dc=com',
	"bind_dn" varchar(500) DEFAULT 'cn=read-only-admin,dc=example,dc=com',
	"bind_password" varchar(255) DEFAULT '',
	"user_filter" varchar(255) DEFAULT '(uid={0})',
	"group_base_dn" varchar(500) DEFAULT 'ou=groups,dc=example,dc=com',
	"group_filter" varchar(255) DEFAULT '(member={0})',
	"role_mappings" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON c.conrelid = t.oid
		JOIN pg_namespace n ON t.relnamespace = n.oid
		WHERE t.relname = 'email_config' AND n.nspname = 'public' AND c.contype = 'c'
	) THEN
		ALTER TABLE "email_config" ADD CONSTRAINT "email_config_id_check" CHECK ("id" = 1);
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class t ON c.conrelid = t.oid
		JOIN pg_namespace n ON t.relnamespace = n.oid
		WHERE t.relname = 'ldap_config' AND n.nspname = 'public' AND c.contype = 'c'
	) THEN
		ALTER TABLE "ldap_config" ADD CONSTRAINT "ldap_config_id_check" CHECK ("id" = 1);
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "email_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "ldap_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
