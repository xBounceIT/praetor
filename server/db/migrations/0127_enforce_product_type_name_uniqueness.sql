-- Type writes are rare and these tables are small. Serialize them while legacy case-only
-- collisions are renamed and case-sensitive uniqueness is replaced, so an older application
-- instance cannot insert another collision between the backfill and index creation.
LOCK TABLE "product_types", "products", "internal_product_categories" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

-- Widen denormalized type columns to match product_types.name (varchar 50) before renaming
-- duplicates with suffixes that may exceed the old varchar(20) limit.
ALTER TABLE "internal_product_categories" ALTER COLUMN "type" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "type" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "type" SET DEFAULT 'item';--> statement-breakpoint

-- Preserve every product type and its stable id. Products and categories store the type name
-- rather than a foreign key, so move those references with each renamed duplicate. For each
-- case-insensitive duplicate group, keep the oldest name and give later rows deterministic,
-- collision-free suffixes.
DO $$
DECLARE
	"type_record" RECORD;
	"candidate_name" TEXT;
	"duplicate_number" INTEGER;
	"suffix" TEXT;
BEGIN
	FOR "type_record" IN
		SELECT "id", "name", "duplicate_rank"
		FROM (
			SELECT
				"id",
				"name",
				ROW_NUMBER() OVER (
					PARTITION BY LOWER("name")
					ORDER BY "created_at" ASC NULLS LAST, "id" ASC
				) AS "duplicate_rank"
			FROM "product_types"
		) AS "ranked_types"
		WHERE "duplicate_rank" > 1
		ORDER BY LOWER("name"), "duplicate_rank"
	LOOP
		"duplicate_number" := "type_record"."duplicate_rank";

		LOOP
			"suffix" := FORMAT(' (duplicate %s)', "duplicate_number");
			"candidate_name" :=
				LEFT("type_record"."name", 50 - CHAR_LENGTH("suffix")) || "suffix";

			EXIT WHEN NOT EXISTS (
				SELECT 1
				FROM "product_types" AS "existing_type"
				WHERE "existing_type"."id" <> "type_record"."id"
					AND LOWER("existing_type"."name") = LOWER("candidate_name")
			);

			"duplicate_number" := "duplicate_number" + 1;
		END LOOP;

		UPDATE "products"
		SET "type" = "candidate_name"
		WHERE "type" = "type_record"."name";

		UPDATE "internal_product_categories"
		SET
			"type" = "candidate_name",
			"updated_at" = CURRENT_TIMESTAMP
		WHERE "type" = "type_record"."name";

		UPDATE "product_types"
		SET
			"name" = "candidate_name",
			"updated_at" = CURRENT_TIMESTAMP
		WHERE "id" = "type_record"."id";
	END LOOP;
END $$;--> statement-breakpoint

-- schema.sql / migration 0016 bootstrap UNIQUE("name") as a table constraint whose backing
-- index shares this name; drop both shapes so the case-insensitive index can replace them.
ALTER TABLE "product_types" DROP CONSTRAINT IF EXISTS "product_types_name_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "product_types_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "product_types_name_unique" ON "product_types" USING btree (lower("name"));
