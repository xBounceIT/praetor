-- First-time-modeling migration for the customer_offer_items table (see db/README.md).
-- All statements are guarded so this is a no-op on existing dev/prod DBs (which already
-- have customer_offer_items + its FK + its CHECK constraint from schema.sql) while still
-- bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "customer_offer_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"offer_id" varchar(100) NOT NULL,
	"product_id" varchar(50),
	"product_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"product_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"product_mol_percentage" numeric(5, 2),
	"discount" numeric(5, 2) DEFAULT '0',
	"note" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"unit_type" varchar(10) DEFAULT 'hours',
	"supplier_quote_id" varchar(100),
	"supplier_quote_item_id" varchar(50),
	"supplier_quote_supplier_name" varchar(255),
	"supplier_quote_unit_price" numeric(15, 2),
	CONSTRAINT "chk_customer_offer_items_unit_type" CHECK ("customer_offer_items"."unit_type" IN ('hours', 'days', 'unit'))
);
--> statement-breakpoint
-- Pre-existing DBs already have an FK from customer_offer_items.offer_id to
-- customer_offers(id) under PG's default name `customer_offer_items_offer_id_fkey`
-- (declared inline in schema.sql). Skip if any FK from this column to customer_offers
-- exists, regardless of name, to avoid duplicating the constraint.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_class ft ON ft.oid = c.confrelid
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
		WHERE c.contype = 'f'
			AND t.relname = 'customer_offer_items'
			AND ft.relname = 'customer_offers'
			AND a.attname = 'offer_id'
	) THEN
		ALTER TABLE "customer_offer_items" ADD CONSTRAINT "customer_offer_items_offer_id_customer_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."customer_offers"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_offer_items_offer_id" ON "customer_offer_items" USING btree ("offer_id");
