-- Channel writes are uncommon and the table is small. Serialize them while legacy case-only
-- collisions are renamed and the old case-sensitive unique constraint is replaced, so an older
-- application instance cannot insert another collision between the backfill and index creation.
LOCK TABLE "quote_communication_channels" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

-- Preserve every channel and its stable id. Quotes reference channels by id, so renaming
-- duplicate labels is safe. For each case-insensitive duplicate group, keep the oldest name and
-- give later rows deterministic, collision-free suffixes.
DO $$
DECLARE
	"channel_record" RECORD;
	"candidate_name" TEXT;
	"duplicate_number" INTEGER;
	"suffix" TEXT;
BEGIN
	FOR "channel_record" IN
		SELECT "id", "name", "duplicate_rank"
		FROM (
			SELECT
				"id",
				"name",
				ROW_NUMBER() OVER (
					PARTITION BY LOWER("name")
					ORDER BY "created_at" ASC NULLS LAST, "id" ASC
				) AS "duplicate_rank"
			FROM "quote_communication_channels"
		) AS "ranked_channels"
		WHERE "duplicate_rank" > 1
		ORDER BY LOWER("name"), "duplicate_rank"
	LOOP
		"duplicate_number" := "channel_record"."duplicate_rank";

		LOOP
			"suffix" := FORMAT(' (duplicate %s)', "duplicate_number");
			"candidate_name" :=
				LEFT("channel_record"."name", 100 - CHAR_LENGTH("suffix")) || "suffix";

			EXIT WHEN NOT EXISTS (
				SELECT 1
				FROM "quote_communication_channels" AS "existing_channel"
				WHERE "existing_channel"."id" <> "channel_record"."id"
					AND LOWER("existing_channel"."name") = LOWER("candidate_name")
			);

			"duplicate_number" := "duplicate_number" + 1;
		END LOOP;

		UPDATE "quote_communication_channels"
		SET
			"name" = "candidate_name",
			"updated_at" = CURRENT_TIMESTAMP
		WHERE "id" = "channel_record"."id";
	END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "quote_communication_channels" DROP CONSTRAINT IF EXISTS "quote_communication_channels_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "quote_communication_channels_name_unique" ON "quote_communication_channels" USING btree (lower("name"));
