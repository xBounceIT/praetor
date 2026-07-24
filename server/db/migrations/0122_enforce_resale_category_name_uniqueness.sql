-- Category writes are rare and the table is small. Serialize them while legacy case-only
-- collisions are renamed and the old case-sensitive index is replaced, so an older application
-- instance cannot insert another collision between the backfill and index creation.
LOCK TABLE "resale_categories" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

-- Preserve every category and its stable id. Activities reference categories by id, so renaming
-- duplicate labels is safe. For each case-insensitive duplicate group, keep the oldest name and
-- give later rows deterministic, collision-free suffixes.
DO $$
DECLARE
	"category_record" RECORD;
	"candidate_name" TEXT;
	"duplicate_number" INTEGER;
	"suffix" TEXT;
BEGIN
	FOR "category_record" IN
		SELECT "id", "name", "duplicate_rank"
		FROM (
			SELECT
				"id",
				"name",
				ROW_NUMBER() OVER (
					PARTITION BY LOWER("name")
					ORDER BY "created_at" ASC NULLS LAST, "id" ASC
				) AS "duplicate_rank"
			FROM "resale_categories"
		) AS "ranked_categories"
		WHERE "duplicate_rank" > 1
		ORDER BY LOWER("name"), "duplicate_rank"
	LOOP
		"duplicate_number" := "category_record"."duplicate_rank";

		LOOP
			"suffix" := FORMAT(' (duplicate %s)', "duplicate_number");
			"candidate_name" :=
				LEFT("category_record"."name", 100 - CHAR_LENGTH("suffix")) || "suffix";

			EXIT WHEN NOT EXISTS (
				SELECT 1
				FROM "resale_categories" AS "existing_category"
				WHERE "existing_category"."id" <> "category_record"."id"
					AND LOWER("existing_category"."name") = LOWER("candidate_name")
			);

			"duplicate_number" := "duplicate_number" + 1;
		END LOOP;

		UPDATE "resale_categories"
		SET
			"name" = "candidate_name",
			"updated_at" = CURRENT_TIMESTAMP
		WHERE "id" = "category_record"."id";
	END LOOP;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "idx_resale_categories_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_resale_categories_name_unique" ON "resale_categories" USING btree (lower("name"));
