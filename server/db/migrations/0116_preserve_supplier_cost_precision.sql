ALTER TABLE "customer_offer_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ALTER COLUMN "unit_price" SET DEFAULT '0';--> statement-breakpoint

-- Existing supplier orders and invoices are historical financial snapshots. Before this
-- migration, their totals multiplied a currency-rounded discounted unit price. Freeze that old
-- unit price into each line before the application switches to precise line math, so opening or
-- resaving an existing document cannot change its total. New documents retain gross price plus
-- discount and therefore use the precise pricing chain. These predicates make the backfill
-- retry-safe.
UPDATE "supplier_sale_items"
SET "unit_price" = ROUND("unit_price" * (1 - COALESCE("discount", 0) / 100.0), 2),
    "discount" = 0
WHERE COALESCE("discount", 0) <> 0;--> statement-breakpoint
UPDATE "supplier_invoice_items"
SET "unit_price" = ROUND("unit_price" * (1 - COALESCE("discount", 0) / 100.0), 2),
    "discount" = 0
WHERE COALESCE("discount", 0) <> 0;--> statement-breakpoint

-- Apply the same freeze to pre-deploy supplier-order versions. Otherwise restoring an old JSONB
-- snapshot would reintroduce gross price plus discount and recalculate the historical document
-- with the new precise line formula. Preserve item order and every unrelated snapshot field.
UPDATE "supplier_order_versions"
SET "snapshot" = jsonb_set(
  "snapshot",
  '{items}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN COALESCE(NULLIF(item ->> 'discount', '')::numeric, 0) <> 0 THEN
            item || jsonb_build_object(
              'unitPrice',
              ROUND(
                COALESCE(NULLIF(item ->> 'unitPrice', '')::numeric, 0) *
                  (1 - COALESCE(NULLIF(item ->> 'discount', '')::numeric, 0) / 100.0),
                2
              ),
              'discount', 0
            )
          ELSE item
        END
        ORDER BY ordinality
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements("snapshot" -> 'items') WITH ORDINALITY AS entry(item, ordinality)
  ),
  false
)
WHERE jsonb_typeof("snapshot" -> 'items') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("snapshot" -> 'items') AS entry(item)
    WHERE COALESCE(NULLIF(item ->> 'discount', '')::numeric, 0) <> 0
  );--> statement-breakpoint

-- Rebuild only costs that still match the old scale-2 formula. A divergent value may be a manual
-- override and must remain authoritative. Client-to-supplier syncs are subtler: the old sync stored
-- the explicit client cost while also deriving a scale-2 list price, so the two cases can look
-- identical numerically. Its durable audit marker therefore conservatively protects every item in
-- a quote that has ever received such a sync. The predicates also make this retry-safe.
UPDATE "supplier_quote_items" AS "target"
SET "unit_price" =
  ("target"."list_price" * (1 - "target"."discount_percent" / 100.0))::numeric(19, 6)
WHERE "target"."unit_price" =
    ROUND("target"."list_price" * (1 - "target"."discount_percent" / 100.0), 2)
  AND "target"."unit_price" IS DISTINCT FROM
    ("target"."list_price" * (1 - "target"."discount_percent" / 100.0))::numeric(19, 6)
  AND NOT EXISTS (
    SELECT 1
    FROM "audit_logs" AS "audit"
    WHERE "audit"."action" = 'supplier_quote.updated'
      AND "audit"."entity_type" = 'supplier_quote'
      AND "audit"."entity_id" = "target"."quote_id"
      AND "audit"."details" ->> 'secondaryLabel' = 'synced_from_client_line'
  );--> statement-breakpoint

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
-- A client-order line already materialized into a supplier order is a historical cost snapshot.
-- Keep it aligned with the frozen supplier order/invoice instead of repricing its margin.
UPDATE "sale_items" AS "target"
SET "supplier_quote_unit_price" = "source"."unit_price"
FROM "supplier_quote_items" AS "source"
WHERE "target"."supplier_quote_item_id" = "source"."id"
  AND "target"."supplier_quote_unit_price" = ROUND("source"."unit_price", 2)
  AND "target"."supplier_sale_id" IS NULL
  AND "target"."supplier_sale_item_id" IS NULL
  AND "target"."supplier_quote_unit_price" IS DISTINCT FROM "source"."unit_price";
