-- First-time-modeling migration for the report_chat_* tables (see db/README.md). All
-- statements are guarded so this is a no-op on existing dev/prod DBs (which already have
-- report_chat_sessions + report_chat_messages + their FKs and indexes from schema.sql)
-- while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "report_chat_messages" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"session_id" varchar(50) NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"thought_content" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_chat_sessions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"title" varchar(255) DEFAULT 'AI Reporting' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
-- Pre-existing DBs already have FKs from schema.sql under PG's default names. Skip if any
-- FK from this column to the parent table exists, regardless of name, to avoid duplicating.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_class ft ON ft.oid = c.confrelid
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
		WHERE c.contype = 'f'
			AND t.relname = 'report_chat_messages'
			AND ft.relname = 'report_chat_sessions'
			AND a.attname = 'session_id'
	) THEN
		ALTER TABLE "report_chat_messages" ADD CONSTRAINT "report_chat_messages_session_id_report_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."report_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_chat_messages_session_created" ON "report_chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_chat_sessions_user_updated" ON "report_chat_sessions" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_chat_sessions_user_archived" ON "report_chat_sessions" USING btree ("user_id","is_archived");
