-- First-time-modeling migration for the single-row config tables (see db/README.md). Both
-- tables already exist in dev/prod from schema.sql, so the CREATE TABLE statements are
-- guarded with IF NOT EXISTS — no-op on existing DBs while still bootstrapping a fresh DB
-- cleanly. Same pattern as 0000_baseline_pre_drizzle and 0001_add_phase3_tables.

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
