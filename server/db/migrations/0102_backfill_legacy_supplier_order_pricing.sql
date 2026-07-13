-- Before supplier orders preserved the quote's full pricing chain, converted lines stored the
-- quote's net unit cost in unit_price and left discount at zero. Restore list price + supplier
-- discount only when the linked quote still provides one unambiguous pricing pair and the order
-- line still exactly matches that net cost. This avoids overwriting later manual edits.
WITH "unambiguous_legacy_pricing" AS (
	SELECT
		"ssi"."id" AS "supplier_sale_item_id",
		MIN("sqi"."list_price") AS "list_price",
		MIN("sqi"."discount_percent") AS "discount_percent"
	FROM "supplier_sale_items" AS "ssi"
	INNER JOIN "supplier_sales" AS "ss" ON "ss"."id" = "ssi"."sale_id"
	INNER JOIN "supplier_quote_items" AS "sqi" ON "sqi"."quote_id" = "ss"."linked_quote_id"
	WHERE
		COALESCE("ssi"."discount", 0) = 0
		AND "sqi"."discount_percent" > 0
		AND "ssi"."unit_price" = "sqi"."unit_price"
		AND (
			("ssi"."product_id" IS NOT NULL AND "sqi"."product_id" = "ssi"."product_id")
			OR (
				"ssi"."product_id" IS NULL
				AND "sqi"."product_id" IS NULL
				AND "sqi"."product_name" = "ssi"."product_name"
			)
		)
	GROUP BY "ssi"."id"
	HAVING
		COUNT(DISTINCT "sqi"."list_price") = 1
		AND COUNT(DISTINCT "sqi"."discount_percent") = 1
)
UPDATE "supplier_sale_items" AS "ssi"
SET
	"unit_price" = "ulp"."list_price",
	"discount" = "ulp"."discount_percent"
FROM "unambiguous_legacy_pricing" AS "ulp"
WHERE "ssi"."id" = "ulp"."supplier_sale_item_id";
