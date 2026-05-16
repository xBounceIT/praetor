-- Migration 0050: enforce NOT NULL on notifications.is_read so the partial
-- index `idx_notifications_user_unread` (predicate `is_read = false`) is
-- usable by the unread queries. See issue #614:
-- `WHERE is_read IS NOT TRUE` (the old repo predicate) does not match the
-- index predicate because `NULL = false` is NULL, not true, so PostgreSQL
-- planned a sequential scan instead. After this migration the column is
-- non-null and the repo can use `is_read = false`, matching the index.
--
-- Backfill must run before the SET NOT NULL or pre-existing NULL rows
-- (rare but legal under the old default-only column) would reject the
-- constraint change.

UPDATE "notifications" SET "is_read" = false WHERE "is_read" IS NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "is_read" SET NOT NULL;
