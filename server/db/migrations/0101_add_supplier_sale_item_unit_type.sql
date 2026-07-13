ALTER TABLE "supplier_sale_items" ADD COLUMN "unit_type" varchar(10) DEFAULT 'hours' NOT NULL;--> statement-breakpoint
WITH "unambiguous_quote_units" AS (
	SELECT
		"ssi"."id" AS "supplier_sale_item_id",
		MIN("sqi"."unit_type") AS "unit_type"
	FROM "supplier_sale_items" AS "ssi"
	INNER JOIN "supplier_sales" AS "ss" ON "ss"."id" = "ssi"."sale_id"
	INNER JOIN "supplier_quote_items" AS "sqi" ON "sqi"."quote_id" = "ss"."linked_quote_id"
	WHERE
		"sqi"."unit_type" IN ('hours', 'days', 'unit')
		AND (
			("ssi"."product_id" IS NOT NULL AND "sqi"."product_id" = "ssi"."product_id")
			OR (
				"ssi"."product_id" IS NULL
				AND "sqi"."product_id" IS NULL
				AND "sqi"."product_name" = "ssi"."product_name"
			)
		)
	GROUP BY "ssi"."id"
	HAVING COUNT(DISTINCT "sqi"."unit_type") = 1
)
UPDATE "supplier_sale_items" AS "ssi"
SET "unit_type" = "uqu"."unit_type"
FROM "unambiguous_quote_units" AS "uqu"
WHERE "ssi"."id" = "uqu"."supplier_sale_item_id";--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD CONSTRAINT "chk_supplier_sale_items_unit_type" CHECK ("supplier_sale_items"."unit_type" IN ('hours', 'days', 'unit'));
