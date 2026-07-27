-- migrationsRunner executes these statements in autocommit mode because they use
-- CONCURRENTLY. Dropping first removes an invalid index left by an interrupted concurrent
-- build; CREATE INDEX CONCURRENTLY IF NOT EXISTS is retry-safe if a prior attempt completed.
DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_entry_key_unique";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_time_entries_user_date_project_task" ON "time_entries" USING btree ("user_id","date","project_id","task");
