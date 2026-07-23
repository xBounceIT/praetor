-- A unique key can hold at most one 24-hour entry. Stop before changing data when a legacy
-- duplicate group cannot be represented by one valid survivor; operators can then reconcile
-- the source rows explicitly without the migration discarding time.
DO $$
DECLARE
	"oversized_group" RECORD;
BEGIN
	SELECT
		"user_id",
		"date",
		"project_id",
		"task",
		SUM("duration") AS "total_duration"
	INTO "oversized_group"
	FROM "time_entries"
	GROUP BY "user_id", "date", "project_id", "task"
	HAVING COUNT(*) > 1 AND SUM("duration") > 24
	ORDER BY "user_id", "date", "project_id", "task"
	LIMIT 1;

	IF FOUND THEN
		RAISE EXCEPTION 'Cannot consolidate duplicate time-entry key with more than 24 hours'
			USING
				ERRCODE = '23514',
				DETAIL = FORMAT(
					'user_id=%s date=%s project_id=%s task=%s total_duration=%s',
					"oversized_group"."user_id",
					"oversized_group"."date",
					"oversized_group"."project_id",
					"oversized_group"."task",
					"oversized_group"."total_duration"
				),
				HINT = 'Reconcile the duplicate rows so their combined duration is at most 24 hours, then retry the migration.';
	END IF;
END $$;
--> statement-breakpoint

-- Temp table used by the consolidation CTE below to detect duplicate groups whose weighted
-- two-decimal hourly cost would change the financial total. The CHECK constraint raises 23514
-- under the FOR UPDATE row locks, so a concurrent insert cannot bypass the guard.
CREATE TEMP TABLE IF NOT EXISTS "migration_0121_cost_guard" (
  "satisfied" BOOLEAN NOT NULL CHECK ("satisfied")
);
--> statement-breakpoint

-- Preserve every legacy duplicate before removing it from the active timesheet. The
-- lowest-version, oldest row is the deterministic survivor because an entry moved onto
-- another key has normally already had its optimistic-lock version incremented. Consolidate
-- the operational ledger into that survivor while the audit copy retains every original row.
-- Lock only rows in duplicate groups so their values cannot change during consolidation while
-- unrelated time-entry writes remain available.
WITH "duplicate_entry_keys" AS (
	SELECT "user_id", "date", "project_id", "task"
	FROM "time_entries"
	GROUP BY "user_id", "date", "project_id", "task"
	HAVING COUNT(*) > 1
),
"locked_time_entries" AS (
	SELECT
		"entry".*,
		EXISTS (
			SELECT 1
			FROM "audit_logs" AS "prior_archive"
			WHERE "prior_archive"."action" = 'time_entry.migration_duplicate_archived'
				AND "prior_archive"."details" ->> 'migration' = '0121_enforce_time_entry_keys'
				AND "prior_archive"."details" ->> 'duplicateOf' = "entry"."id"
		) AS "is_prior_survivor"
	FROM "time_entries" AS "entry"
	JOIN "duplicate_entry_keys" AS "duplicate_key"
		ON "duplicate_key"."user_id" = "entry"."user_id"
		AND "duplicate_key"."date" = "entry"."date"
		AND "duplicate_key"."project_id" = "entry"."project_id"
		AND "duplicate_key"."task" = "entry"."task"
	FOR UPDATE OF "entry"
),
"inexact_cost_guard" AS (
  INSERT INTO "migration_0121_cost_guard" ("satisfied")
  SELECT FALSE
  FROM "locked_time_entries"
  GROUP BY "user_id", "date", "project_id", "task"
  HAVING COUNT(*) > 1
    AND SUM(COALESCE("duration", 0)) > 0
    AND ROUND(
      SUM(COALESCE("duration", 0) * COALESCE("hourly_cost", 0)) /
      SUM(COALESCE("duration", 0)),
      2
    ) * SUM(COALESCE("duration", 0)) <>
      SUM(COALESCE("duration", 0) * COALESCE("hourly_cost", 0))
),
"ranked_time_entries" AS (
	SELECT
		"locked_time_entries".*,
		FIRST_VALUE("id") OVER "entry_key_order" AS "survivor_id",
		ROW_NUMBER() OVER "entry_key_order" AS "entry_key_rank"
	FROM "locked_time_entries"
	WINDOW "entry_key_order" AS (
		PARTITION BY "user_id", "date", "project_id", "task"
		ORDER BY
			"is_prior_survivor" DESC,
			"version" ASC NULLS LAST,
			"created_at" ASC NULLS LAST,
			"id" ASC
	)
),
"consolidated_time_entries" AS (
	SELECT
		"survivor_id",
		SUM(COALESCE("duration", 0)) AS "merged_duration",
		CASE
			WHEN SUM(COALESCE("duration", 0)) > 0 THEN ROUND(
				SUM(COALESCE("duration", 0) * COALESCE("hourly_cost", 0)) /
				SUM(COALESCE("duration", 0)),
				2
			)
			ELSE (ARRAY_AGG("hourly_cost" ORDER BY "entry_key_rank"))[1]
		END AS "merged_hourly_cost",
		STRING_AGG(
			"notes",
			E'\n\n---\n\n'
			ORDER BY "entry_key_rank"
		) FILTER (WHERE NULLIF(BTRIM("notes"), '') IS NOT NULL) AS "merged_notes",
		BOOL_AND(COALESCE("is_placeholder", FALSE)) AS "all_placeholders"
	FROM "ranked_time_entries"
	GROUP BY "survivor_id"
	HAVING COUNT(*) > 1
),
"updated_survivors" AS (
	UPDATE "time_entries" AS "survivor"
	SET
		"duration" = "consolidated"."merged_duration",
		"hourly_cost" = COALESCE("consolidated"."merged_hourly_cost", 0),
		"notes" = "consolidated"."merged_notes",
		"is_placeholder" = "consolidated"."all_placeholders",
		"version" = "survivor"."version" + 1
	FROM "consolidated_time_entries" AS "consolidated"
	WHERE "survivor"."id" = "consolidated"."survivor_id"
	RETURNING "survivor"."id"
),
"duplicate_time_entries" AS (
	SELECT "id", "survivor_id"
	FROM "ranked_time_entries"
	WHERE "entry_key_rank" > 1
),
"archived_time_entries" AS (
	INSERT INTO "audit_logs" (
		"id",
		"user_id",
		"action",
		"entity_type",
		"entity_id",
		"ip_address",
		"details",
		"created_at"
	)
	SELECT
		'mig0121_' || MD5("duplicate_entry"."id"),
		"duplicate_entry"."user_id",
		'time_entry.migration_duplicate_archived',
		'time_entry',
		"duplicate_entry"."id",
		'database-migration',
		JSONB_BUILD_OBJECT(
			'migration', '0121_enforce_time_entry_keys',
			'duplicateOf', "duplicate"."survivor_id",
			'archivedRow', TO_JSONB("duplicate_entry")
		),
		CURRENT_TIMESTAMP
	FROM "duplicate_time_entries" AS "duplicate"
	JOIN "time_entries" AS "duplicate_entry"
		ON "duplicate_entry"."id" = "duplicate"."id"
	ON CONFLICT ("id") DO UPDATE
	SET "id" = EXCLUDED."id"
	WHERE "audit_logs"."action" = EXCLUDED."action"
		AND "audit_logs"."entity_id" = EXCLUDED."entity_id"
		AND "audit_logs"."details" ->> 'duplicateOf' =
			EXCLUDED."details" ->> 'duplicateOf'
	RETURNING
		"entity_id",
		"details" ->> 'duplicateOf' AS "survivor_id"
)
-- Delete only rows returned by the matching archive insert. A hash collision or failed
-- archive therefore stops the unique-index build instead of silently dropping data.
DELETE FROM "time_entries" AS "duplicate_entry"
USING "duplicate_time_entries" AS "duplicate", "archived_time_entries" AS "archive"
WHERE "duplicate_entry"."id" = "duplicate"."id"
	AND "archive"."entity_id" = "duplicate_entry"."id"
	AND "archive"."survivor_id" = "duplicate"."survivor_id"
	AND EXISTS (
		SELECT 1
		FROM "updated_survivors" AS "updated"
		WHERE "updated"."id" = "duplicate"."survivor_id"
	);--> statement-breakpoint

-- migrationsRunner executes these statements in autocommit mode. Dropping first removes an
-- invalid index left by an interrupted concurrent build. If an older instance recreates a
-- duplicate after the backfill commits, PostgreSQL fails the unique build safely; the migration
-- remains pending and a retry consolidates that row before replacing the invalid index.
DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_entry_key_unique";--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY "idx_time_entries_entry_key_unique" ON "time_entries" USING btree ("user_id","date","project_id","task");--> statement-breakpoint

DROP TABLE IF EXISTS "migration_0121_cost_guard";