ALTER TABLE "quote_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked_items AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "quote_id" ORDER BY "created_at" ASC NULLS LAST, "id" ASC
    ) - 1 AS "position"
  FROM "quote_items"
)
UPDATE "quote_items" AS qi
SET "position" = ranked_items."position"
FROM ranked_items
WHERE qi."id" = ranked_items."id";--> statement-breakpoint
CREATE INDEX "idx_quote_items_quote_position" ON "quote_items" USING btree ("quote_id","position");
