-- Supplier code writes are uncommon and the table is typically small. Serialize them while
-- legacy case-only collisions are renamed and the unique index is created, so an older
-- application instance cannot insert another collision between the backfill and index creation.
LOCK TABLE "suppliers" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

-- Preserve every supplier and its stable id. Documents reference suppliers by id, so renaming
-- duplicate codes is safe. For each case-insensitive duplicate group, keep the oldest code and
-- give later rows deterministic, collision-free suffixes within the varchar(50) limit.
DO $$
DECLARE
	"supplier_record" RECORD;
	"candidate_code" TEXT;
	"duplicate_number" INTEGER;
	"suffix" TEXT;
BEGIN
	FOR "supplier_record" IN
		SELECT "id", "supplier_code", "duplicate_rank"
		FROM (
			SELECT
				"id",
				"supplier_code",
				ROW_NUMBER() OVER (
					PARTITION BY LOWER("supplier_code")
					ORDER BY "created_at" ASC NULLS LAST, "id" ASC
				) AS "duplicate_rank"
			FROM "suppliers"
			WHERE "supplier_code" IS NOT NULL AND "supplier_code" <> ''
		) AS "ranked_suppliers"
		WHERE "duplicate_rank" > 1
		ORDER BY LOWER("supplier_code"), "duplicate_rank"
	LOOP
		"duplicate_number" := "supplier_record"."duplicate_rank";

		LOOP
			"suffix" := FORMAT(' (duplicate %s)', "duplicate_number");
			"candidate_code" :=
				LEFT("supplier_record"."supplier_code", 50 - CHAR_LENGTH("suffix")) || "suffix";

			EXIT WHEN NOT EXISTS (
				SELECT 1
				FROM "suppliers" AS "existing_supplier"
				WHERE "existing_supplier"."id" <> "supplier_record"."id"
					AND "existing_supplier"."supplier_code" IS NOT NULL
					AND "existing_supplier"."supplier_code" <> ''
					AND LOWER("existing_supplier"."supplier_code") = LOWER("candidate_code")
			);

			"duplicate_number" := "duplicate_number" + 1;
		END LOOP;

		UPDATE "suppliers"
		SET "supplier_code" = "candidate_code"
		WHERE "id" = "supplier_record"."id";
	END LOOP;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "idx_suppliers_supplier_code_unique" ON "suppliers" USING btree (LOWER("supplier_code")) WHERE "suppliers"."supplier_code" IS NOT NULL AND "suppliers"."supplier_code" <> '';
