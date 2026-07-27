-- migrationsRunner executes these statements in autocommit mode because they use
-- CONCURRENTLY. Drop the unique key first, then drop any prior replacement index (including an
-- invalid one left by an interrupted concurrent build) before recreating it, matching 0121.
DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_entry_key_unique";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_user_date_project_task";--> statement-breakpoint
CREATE INDEX CONCURRENTLY "idx_time_entries_user_date_project_task" ON "time_entries" USING btree ("user_id","date","project_id","task");
