-- First-time-modeling migration for the supplier_invoices family (see db/README.md). All
-- statements are guarded so this is a no-op on existing dev/prod DBs (which already have
-- supplier_invoices + supplier_invoice_items + their FKs and indexes from schema.sql)
-- while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "supplier_invoice_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(100) NOT NULL,
	"product_id" varchar(50),
	"description" varchar(255) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_invoices" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"linked_sale_id" varchar(100),
	"supplier_id" varchar(50) NOT NULL,
	"supplier_name" varchar(255) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
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
			AND t.relname = 'supplier_invoice_items'
			AND ft.relname = 'supplier_invoices'
			AND a.attname = 'invoice_id'
	) THEN
		ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE cascade;
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
			AND t.relname = 'supplier_invoices'
			AND ft.relname = 'supplier_sales'
			AND a.attname = 'linked_sale_id'
	) THEN
		ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_linked_sale_id_supplier_sales_id_fk" FOREIGN KEY ("linked_sale_id") REFERENCES "public"."supplier_sales"("id") ON DELETE set null ON UPDATE cascade;
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
			AND t.relname = 'supplier_invoices'
			AND ft.relname = 'suppliers'
			AND a.attname = 'supplier_id'
	) THEN
		ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_invoice_items_invoice_id" ON "supplier_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_supplier_id" ON "supplier_invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_status" ON "supplier_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_issue_date" ON "supplier_invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_invoices_linked_sale_id" ON "supplier_invoices" USING btree ("linked_sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_supplier_invoices_linked_sale_id_unique" ON "supplier_invoices" USING btree ("linked_sale_id") WHERE "supplier_invoices"."linked_sale_id" IS NOT NULL;
