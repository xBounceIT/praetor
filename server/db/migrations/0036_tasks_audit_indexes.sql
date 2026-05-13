-- idx_tasks_project_id is already present on DBs bootstrapped from
-- server/db/schema.sql (line 730, `CREATE INDEX IF NOT EXISTS`), so use the
-- idempotent form to avoid collisions on existing dev DBs. idx_time_entries_client_id
-- gets the same guard for consistency and safety on partially-patched DBs.
-- See server/db/README.md "Idempotent guards" for the pattern.
CREATE INDEX IF NOT EXISTS "idx_tasks_project_id" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_client_id" ON "time_entries" USING btree ("client_id");
