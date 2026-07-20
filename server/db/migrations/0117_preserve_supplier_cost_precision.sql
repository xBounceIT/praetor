ALTER TABLE "customer_offer_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(19, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ALTER COLUMN "unit_price" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "supplier_invoice_items" ADD COLUMN "legacy_discount_rounding" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD COLUMN "legacy_discount_rounding" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Rebuild only costs that still match the old scale-2 formula. A divergent value may be a manual
-- override and must remain authoritative. Client-to-supplier syncs are subtler: the old sync stored
-- the explicit client cost while also deriving a scale-2 list price, so the two cases can look
-- identical numerically. Its durable audit marker therefore conservatively protects every item in
-- a quote that has ever received such a sync. Version rows follow quote-id renames through their
-- FK while snapshot.quote.id retains the historical id, so they also resolve pre-rename markers.
-- The predicates make this retry-safe.
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
      AND (
        "audit"."entity_id" = "target"."quote_id"
        OR EXISTS (
          SELECT 1
          FROM "supplier_quote_versions" AS "version"
          WHERE "version"."quote_id" = "target"."quote_id"
            AND "version"."snapshot" -> 'quote' ->> 'id' = "audit"."entity_id"
        )
      )
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

-- Apply the same guarded precision upgrade to restorable client quote/offer versions. Only a
-- numeric snapshot cost matching the current supplier cost at the former scale is rewritten;
-- non-matching stale or manually edited costs remain untouched. Preserve item order and fields.
UPDATE "quote_versions" AS "version"
SET "snapshot" = jsonb_set(
  "version"."snapshot",
  '{items}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN "source"."id" IS NOT NULL THEN
            item || jsonb_build_object('supplierQuoteUnitPrice', "source"."unit_price")
          ELSE item
        END
        ORDER BY ordinality
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements("version"."snapshot" -> 'items')
      WITH ORDINALITY AS entry(item, ordinality)
    LEFT JOIN "supplier_quote_items" AS "source"
      ON "source"."id" = item ->> 'supplierQuoteItemId'
      AND CASE
        WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
          THEN (item ->> 'supplierQuoteUnitPrice')::numeric
      END = ROUND("source"."unit_price", 2)
      AND CASE
        WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
          THEN (item ->> 'supplierQuoteUnitPrice')::numeric
      END IS DISTINCT FROM "source"."unit_price"
  ),
  false
)
WHERE jsonb_typeof("version"."snapshot" -> 'items') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("version"."snapshot" -> 'items') AS entry(item)
    JOIN "supplier_quote_items" AS "source"
      ON "source"."id" = item ->> 'supplierQuoteItemId'
    WHERE CASE
      WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
        THEN (item ->> 'supplierQuoteUnitPrice')::numeric
    END = ROUND("source"."unit_price", 2)
      AND CASE
        WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
          THEN (item ->> 'supplierQuoteUnitPrice')::numeric
      END IS DISTINCT FROM "source"."unit_price"
  );--> statement-breakpoint
UPDATE "offer_versions" AS "version"
SET "snapshot" = jsonb_set(
  "version"."snapshot",
  '{items}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN "source"."id" IS NOT NULL THEN
            item || jsonb_build_object('supplierQuoteUnitPrice', "source"."unit_price")
          ELSE item
        END
        ORDER BY ordinality
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements("version"."snapshot" -> 'items')
      WITH ORDINALITY AS entry(item, ordinality)
    LEFT JOIN "supplier_quote_items" AS "source"
      ON "source"."id" = item ->> 'supplierQuoteItemId'
      AND CASE
        WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
          THEN (item ->> 'supplierQuoteUnitPrice')::numeric
      END = ROUND("source"."unit_price", 2)
      AND CASE
        WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
          THEN (item ->> 'supplierQuoteUnitPrice')::numeric
      END IS DISTINCT FROM "source"."unit_price"
  ),
  false
)
WHERE jsonb_typeof("version"."snapshot" -> 'items') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("version"."snapshot" -> 'items') AS entry(item)
    JOIN "supplier_quote_items" AS "source"
      ON "source"."id" = item ->> 'supplierQuoteItemId'
    WHERE CASE
      WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
        THEN (item ->> 'supplierQuoteUnitPrice')::numeric
    END = ROUND("source"."unit_price", 2)
      AND CASE
        WHEN jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'
          THEN (item ->> 'supplierQuoteUnitPrice')::numeric
      END IS DISTINCT FROM "source"."unit_price"
  );--> statement-breakpoint

-- A client-order line already materialized into a supplier order is a historical cost snapshot.
-- Keep it aligned with the frozen supplier order/invoice instead of repricing its margin.
UPDATE "sale_items" AS "target"
SET "supplier_quote_unit_price" = "source"."unit_price"
FROM "supplier_quote_items" AS "source"
WHERE "target"."supplier_quote_item_id" = "source"."id"
  AND "target"."supplier_quote_unit_price" = ROUND("source"."unit_price", 2)
  AND "target"."supplier_sale_id" IS NULL
  AND "target"."supplier_sale_item_id" IS NULL
  AND "target"."supplier_quote_unit_price" IS DISTINCT FROM "source"."unit_price";--> statement-breakpoint

-- Existing supplier documents used a currency-rounded net unit before applying quantity/duration.
-- The legacy-safe default preserves their calculation provenance and also protects writes from an
-- old app instance during a rolling deployment. Current writers explicitly persist false for newly
-- authored precise lines. Gross prices and negotiated discounts remain untouched.

-- Version snapshots must carry the same marker or restoring a pre-upgrade order would switch its
-- total to precise line math. Preserve every original pricing field and item order.
UPDATE "supplier_order_versions"
SET "snapshot" = jsonb_set(
  "snapshot",
  '{items}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN COALESCE(NULLIF(item ->> 'discount', '')::numeric, 0) <> 0
            AND item -> 'legacyDiscountRounding' IS DISTINCT FROM 'true'::jsonb
          THEN item || jsonb_build_object('legacyDiscountRounding', true)
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
      AND item -> 'legacyDiscountRounding' IS DISTINCT FROM 'true'::jsonb
  );
