-- First-time-modeling migration for the audit_logs table (see db/README.md). All statements
-- are guarded with IF NOT EXISTS so this is a no-op on existing dev/prod DBs (which already
-- have audit_logs from schema.sql) while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"action" varchar(100) DEFAULT 'user.login' NOT NULL,
	"entity_type" varchar(50),
	"entity_id" varchar(100),
	"ip_address" varchar(255) NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
-- Carry-forward of the legacy `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB`
-- from schema.sql. Some pre-existing DBs were bootstrapped before `details` was added inline,
-- so the CREATE TABLE IF NOT EXISTS above no-ops on them and would leave the column missing.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "details" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs" USING btree ("action");
