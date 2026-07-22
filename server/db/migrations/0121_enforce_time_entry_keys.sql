-- Preserve every legacy duplicate before removing it from the active timesheet. The
-- lowest-version, oldest row is the deterministic survivor because an entry moved onto
-- another key has normally already had its optimistic-lock version incremented.
WITH "ranked_time_entries" AS (
	SELECT
		"id",
		FIRST_VALUE("id") OVER "entry_key_order" AS "survivor_id",
		ROW_NUMBER() OVER "entry_key_order" AS "entry_key_rank"
	FROM "time_entries"
	WINDOW "entry_key_order" AS (
		PARTITION BY "user_id", "date", "project_id", "task"
		ORDER BY "version" ASC NULLS LAST, "created_at" ASC NULLS LAST, "id" ASC
	)
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
	AND "archive"."survivor_id" = "duplicate"."survivor_id";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_time_entries_entry_key_unique" ON "time_entries" USING btree ("user_id","date","project_id","task");
