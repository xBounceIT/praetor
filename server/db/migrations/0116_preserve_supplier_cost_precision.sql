ALTER TABLE "customer_offer_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ALTER COLUMN "unit_price" SET DEFAULT '0';--> statement-breakpoint

-- Rebuild the supplier quote's derived unit cost from its scale-2 source operands. This restores
-- fractional cents lost by the old numeric(15,2) column and is retry-safe after a partial run.
UPDATE "supplier_quote_items"
SET "unit_price" = ("list_price" * (1 - "discount_percent" / 100.0))::numeric(19, 6)
WHERE "unit_price" IS DISTINCT FROM
  ("list_price" * (1 - "discount_percent" / 100.0))::numeric(19, 6);--> statement-breakpoint

-- Upgrade only client-document snapshots that still match the CURRENT supplier cost at the old
-- two-decimal scale. Deliberately preserve stale or manually edited historical snapshots.
UPDATE "quote_items" AS "target"
SET "supplier_quote_unit_price" = "source"."unit_price"
FROM "supplier_quote_items" AS "source"
WHERE "target"."supplier_quote_item_id" = "source"."id"
  AND "target"."supplier_quote_unit_price" = ROUND("source"."unit_price", 2)
  AND "target"."supplier_quote_unit_price" IS DISTINCT FROM "source"."unit_price";--> statement-breakpoint
UPDATE "customer_offer_items" AS "target"
SET "supplier_quote_unit_price" = "source"."unit_price"
FROM "supplier_quote_items" AS "source"
WHERE "target"."supplier_quote_item_id" = "source"."id"
  AND "target"."supplier_quote_unit_price" = ROUND("source"."unit_price", 2)
  AND "target"."supplier_quote_unit_price" IS DISTINCT FROM "source"."unit_price";--> statement-breakpoint
UPDATE "sale_items" AS "target"
SET "supplier_quote_unit_price" = "source"."unit_price"
FROM "supplier_quote_items" AS "source"
WHERE "target"."supplier_quote_item_id" = "source"."id"
  AND "target"."supplier_quote_unit_price" = ROUND("source"."unit_price", 2)
  AND "target"."supplier_quote_unit_price" IS DISTINCT FROM "source"."unit_price";
