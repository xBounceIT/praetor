-- Hand-edited from `drizzle-kit generate` output: CREATE TABLE/INDEX changed
-- to CREATE ... IF NOT EXISTS so this baseline is a no-op against dev/prod DBs
-- that already have notifications from schema.sql, while still bootstrapping a
-- fresh DB cleanly. The snapshot in meta/0000_snapshot.json is intentionally
-- left as drizzle-kit emitted it so future generates diff cleanly.
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"data" jsonb,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","is_read") WHERE "notifications"."is_read" = false;
