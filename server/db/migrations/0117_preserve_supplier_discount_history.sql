ALTER TABLE "supplier_invoice_items" ADD COLUMN "legacy_discount_rounding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD COLUMN "legacy_discount_rounding" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Existing discounted supplier documents used a currency-rounded net unit before applying
-- quantity/duration. Preserve that calculation provenance without overwriting the stored gross
-- price or negotiated discount. New rows keep the precise default (false).
UPDATE "supplier_invoice_items"
SET "legacy_discount_rounding" = true
WHERE COALESCE("discount", 0) <> 0
  AND NOT "legacy_discount_rounding";--> statement-breakpoint
UPDATE "supplier_sale_items"
SET "legacy_discount_rounding" = true
WHERE COALESCE("discount", 0) <> 0
  AND NOT "legacy_discount_rounding";--> statement-breakpoint

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
