-- First-time-modeling migration for the products family (see db/README.md). All statements
-- are guarded so this is a no-op on existing dev/prod DBs (which already have products,
-- product_types, internal_product_categories, internal_product_subcategories + their FKs
-- and indexes from schema.sql) while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "internal_product_categories" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"cost_unit" varchar(20) DEFAULT 'unit' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"product_code" varchar(50) NOT NULL,
	"costo" numeric(15, 2) DEFAULT '0' NOT NULL,
	"mol_percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cost_unit" varchar(20) DEFAULT 'unit' NOT NULL,
	"category" varchar(100),
	"type" varchar(20) DEFAULT 'item' NOT NULL,
	"description" text,
	"subcategory" varchar(100),
	"is_disabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"supplier_id" varchar(50)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_product_subcategories" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"category_id" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_types" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"cost_unit" varchar(20) DEFAULT 'unit' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "product_types_name_unique" UNIQUE("name")
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
			AND t.relname = 'products'
			AND ft.relname = 'suppliers'
			AND a.attname = 'supplier_id'
	) THEN
		ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
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
			AND t.relname = 'internal_product_subcategories'
			AND ft.relname = 'internal_product_categories'
			AND a.attname = 'category_id'
	) THEN
		ALTER TABLE "internal_product_subcategories" ADD CONSTRAINT "internal_product_subcategories_category_id_internal_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."internal_product_categories"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_internal_product_categories_type" ON "internal_product_categories" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_name" ON "products" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_name_unique" ON "products" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_product_code_unique" ON "products" USING btree ("product_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_supplier_id" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_type" ON "products" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_internal_product_subcategories_category_id" ON "internal_product_subcategories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_types_name" ON "product_types" USING btree ("name");
