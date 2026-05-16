-- Migration 0049: backfill pre-#590 duration overflow and add CHECK constraints.
--
-- Background: PR #590 capped `duration` (on `time_entries`) and `recurrence_duration` (on
-- `tasks`) at 24 hours on the way in (AJV + service-level guard). Issue #593 noted two gaps:
--   1. Rows written *before* #590 with `duration > 24` (e.g. the `1_000_000` typo from #516)
--      survive untouched and keep poisoning cost/billing aggregates.
--   2. A recurring task template whose `recurrence_duration` was set before the cap keeps
--      producing poisoned entries via `generateRecurringEntries` until someone manually
--      edits the template.
--
-- Order matters: the clamp UPDATEs must run before the ADD CONSTRAINTs, otherwise
-- constraint creation fails on the pre-existing out-of-range rows.
--
-- Data loss note: the clamp throws away the magnitude of the bad value (`1_000_000` → `24`).
-- This is intentional — the rows are already poisoning aggregates and the original value is
-- meaningless. Operators with audit-trail concerns should run their own reconciliation
-- query against backups before applying this migration.

UPDATE "time_entries" SET "duration" = 24 WHERE "duration" > 24;--> statement-breakpoint
UPDATE "time_entries" SET "duration" = 0 WHERE "duration" < 0;--> statement-breakpoint
UPDATE "tasks" SET "recurrence_duration" = 24 WHERE "recurrence_duration" > 24;--> statement-breakpoint
UPDATE "tasks" SET "recurrence_duration" = 0 WHERE "recurrence_duration" < 0;--> statement-breakpoint

-- Idempotent ADD CONSTRAINT pattern — see server/db/README.md "Idempotent guards".
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		WHERE c.contype = 'c'
			AND c.conname = 'time_entries_duration_max_check'
			AND t.relname = 'time_entries'
	) THEN
		ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_duration_max_check" CHECK ("time_entries"."duration" >= 0 AND "time_entries"."duration" <= 24);
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		WHERE c.contype = 'c'
			AND c.conname = 'tasks_recurrence_duration_max_check'
			AND t.relname = 'tasks'
	) THEN
		ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_duration_max_check" CHECK ("tasks"."recurrence_duration" IS NULL OR ("tasks"."recurrence_duration" >= 0 AND "tasks"."recurrence_duration" <= 24));
	END IF;
END $$;
