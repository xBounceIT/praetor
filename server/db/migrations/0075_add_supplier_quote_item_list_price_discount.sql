ALTER TABLE "supplier_quote_items" ADD COLUMN "list_price" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Backfill: existing rows have no list price, so seed it from the pre-existing net unit cost
-- (with discount_percent left at 0) to preserve each legacy line's Costo unitario and Totale.
UPDATE "supplier_quote_items" SET "list_price" = "unit_price";--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "chk_supplier_quote_items_discount_percent" CHECK ("supplier_quote_items"."discount_percent" >= 0 AND "supplier_quote_items"."discount_percent" <= 100);