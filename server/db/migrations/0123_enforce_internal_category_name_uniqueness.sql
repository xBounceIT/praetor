-- Category writes are rare and the table is small. Serialize them while legacy case-only
-- collisions are renamed and case-sensitive uniqueness is replaced, so an older application
-- instance cannot insert another collision between the backfill and index creation.
LOCK TABLE "internal_product_categories" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

-- Preserve every category and its stable id. For each case-insensitive duplicate group, keep the
-- oldest category name and give later rows deterministic, collision-free suffixes. Internal
-- products use the category name rather than a foreign key, so move those references with the
-- renamed category. Supplier products are deliberately excluded, matching the application rules.
DO $$
DECLARE
	"category_record" RECORD;
	"candidate_name" TEXT;
	"duplicate_number" INTEGER;
	"suffix" TEXT;
BEGIN
	FOR "category_record" IN
		SELECT "id", "name", "type", "duplicate_rank"
		FROM (
			SELECT
				"id",
				"name",
				"type",
				ROW_NUMBER() OVER (
					PARTITION BY LOWER("name"), "type"
					ORDER BY "created_at" ASC NULLS LAST, "id" ASC
				) AS "duplicate_rank"
			FROM "internal_product_categories"
		) AS "ranked_categories"
		WHERE "duplicate_rank" > 1
		ORDER BY "type", LOWER("name"), "duplicate_rank"
	LOOP
		"duplicate_number" := "category_record"."duplicate_rank";

		LOOP
			"suffix" := FORMAT(' (duplicate %s)', "duplicate_number");
			"candidate_name" :=
				LEFT("category_record"."name", 100 - CHAR_LENGTH("suffix")) || "suffix";

			EXIT WHEN NOT EXISTS (
				SELECT 1
				FROM "internal_product_categories" AS "existing_category"
				WHERE "existing_category"."id" <> "category_record"."id"
					AND "existing_category"."type" = "category_record"."type"
					AND LOWER("existing_category"."name") = LOWER("candidate_name")
			);

			"duplicate_number" := "duplicate_number" + 1;
		END LOOP;

		UPDATE "products"
		SET "category" = "candidate_name"
		WHERE "category" = "category_record"."name"
			AND "type" = "category_record"."type"
			AND "supplier_id" IS NULL;

		UPDATE "internal_product_categories"
		SET
			"name" = "candidate_name",
			"updated_at" = CURRENT_TIMESTAMP
		WHERE "id" = "category_record"."id";
	END LOOP;
END $$;--> statement-breakpoint

-- schema.sql bootstraps UNIQUE (name, type) as a table constraint whose backing index shares
-- this name; drizzle-only installs may only have the unique index from migration 0016. Drop both
-- shapes so the case-insensitive index can replace them.
ALTER TABLE "internal_product_categories" DROP CONSTRAINT IF EXISTS "internal_product_categories_name_type_key";--> statement-breakpoint
DROP INDEX IF EXISTS "internal_product_categories_name_type_key";--> statement-breakpoint
CREATE UNIQUE INDEX "internal_product_categories_name_type_key" ON "internal_product_categories" USING btree (lower("name"),"type");