-- First-time-modeling migration for the supplier_quotes family (see db/README.md). All
-- statements are guarded so this is a no-op on existing dev/prod DBs (which already have
-- supplier_quotes + supplier_quote_items + their FKs and indexes from schema.sql) while
-- still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "supplier_quote_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"quote_id" varchar(100) NOT NULL,
	"product_id" varchar(50),
	"product_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"unit_type" varchar(10) DEFAULT 'hours'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_quotes" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"supplier_id" varchar(50) NOT NULL,
	"supplier_name" varchar(255) NOT NULL,
	"payment_terms" varchar(20) DEFAULT 'immediate' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"expiration_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
-- Pre-existing DBs already have FKs from schema.sql under PG's default names. Skip if any
-- FK from this column to the parent table exists, regardless of name, to avoid duplicating.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_class ft ON ft.oid = c.confrelid
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
		WHERE c.contype = 'f'
			AND t.relname = 'supplier_quote_items'
			AND ft.relname = 'supplier_quotes'
			AND a.attname = 'quote_id'
	) THEN
		ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_quote_id_supplier_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_class ft ON ft.oid = c.confrelid
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
		WHERE c.contype = 'f'
			AND t.relname = 'supplier_quotes'
			AND ft.relname = 'suppliers'
			AND a.attname = 'supplier_id'
	) THEN
		ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_quote_items_quote_id" ON "supplier_quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_quotes_supplier_id" ON "supplier_quotes" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_quotes_status" ON "supplier_quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_quotes_created_at" ON "supplier_quotes" USING btree ("created_at");
