-- First-time-modeling migration for Phase 3 tables (see db/README.md). All statements are
-- guarded with IF NOT EXISTS / pg_constraint checks so this is a no-op on existing dev/prod
-- DBs (which already have these tables from schema.sql) while still bootstrapping a fresh
-- DB cleanly.

CREATE TABLE IF NOT EXISTS "customer_offers" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"linked_quote_id" varchar(100) NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"payment_terms" varchar(20) DEFAULT 'immediate' NOT NULL,
	"discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_type" varchar(10) DEFAULT 'percentage' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"expiration_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(100) NOT NULL,
	"product_id" varchar(50),
	"description" varchar(255) NOT NULL,
	"unit_of_measure" varchar(20) DEFAULT 'unit' NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"linked_sale_id" varchar(100),
	"client_id" varchar(50) NOT NULL,
	"client_name" varchar(255) NOT NULL,
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
CREATE TABLE IF NOT EXISTS "quote_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"quote_id" varchar(100) NOT NULL,
	"product_id" varchar(50),
	"product_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"product_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"product_mol_percentage" numeric(5, 2),
	"supplier_quote_id" varchar(100),
	"supplier_quote_item_id" varchar(50),
	"supplier_quote_supplier_name" varchar(255),
	"supplier_quote_unit_price" numeric(15, 2),
	"discount" numeric(5, 2) DEFAULT '0',
	"note" text,
	"unit_type" varchar(10) DEFAULT 'hours',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quotes" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"payment_terms" varchar(20) DEFAULT 'immediate' NOT NULL,
	"discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_type" varchar(10) DEFAULT 'percentage' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"expiration_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" varchar(50) NOT NULL,
	"permission" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_system" boolean DEFAULT false,
	"is_admin" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" varchar(50) NOT NULL,
	"role_id" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"sale_id" varchar(100) NOT NULL,
	"product_id" varchar(50) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"product_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"product_mol_percentage" numeric(5, 2),
	"discount" numeric(5, 2) DEFAULT '0',
	"unit_type" varchar(10) DEFAULT 'hours',
	"note" text,
	"supplier_quote_id" varchar(100),
	"supplier_quote_item_id" varchar(50),
	"supplier_quote_supplier_name" varchar(255),
	"supplier_quote_unit_price" numeric(15, 2),
	"supplier_sale_id" varchar(100),
	"supplier_sale_item_id" varchar(50),
	"supplier_sale_supplier_name" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"linked_quote_id" varchar(100),
	"linked_offer_id" varchar(100),
	"client_id" varchar(50) NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"payment_terms" varchar(20) DEFAULT 'immediate' NOT NULL,
	"discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_type" varchar(10) DEFAULT 'percentage' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"full_name" varchar(255),
	"email" varchar(255),
	"language" varchar(10) DEFAULT 'auto' NOT NULL,
	"daily_goal" numeric(4, 2) DEFAULT '8.00',
	"start_of_week" varchar(10) DEFAULT 'Monday',
	"compact_view" boolean DEFAULT false,
	"treat_saturday_as_holiday" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_sale_items" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"sale_id" varchar(100) NOT NULL,
	"product_id" varchar(50),
	"product_name" varchar(255) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(5, 2) DEFAULT '0',
	"note" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_sales" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"linked_quote_id" varchar(100),
	"supplier_id" varchar(50) NOT NULL,
	"supplier_name" varchar(255) NOT NULL,
	"payment_terms" varchar(20) DEFAULT 'immediate' NOT NULL,
	"discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_type" varchar(10) DEFAULT 'percentage' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"description" text,
	"is_recurring" boolean DEFAULT false,
	"recurrence_pattern" varchar(50),
	"recurrence_start" date,
	"recurrence_end" date,
	"recurrence_duration" numeric(10, 2) DEFAULT '0',
	"expected_effort" numeric(10, 2) DEFAULT '0',
	"revenue" numeric(15, 2) DEFAULT '0',
	"notes" text,
	"is_disabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_tasks" (
	"user_id" varchar(50) NOT NULL,
	"task_id" varchar(50) NOT NULL,
	"assignment_source" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "user_tasks_user_id_task_id_pk" PRIMARY KEY("user_id","task_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"date" date NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"project_name" varchar(255) NOT NULL,
	"task" varchar(255) NOT NULL,
	"task_id" varchar(50),
	"notes" text,
	"duration" numeric(10, 2) DEFAULT '0' NOT NULL,
	"hourly_cost" numeric(10, 2) DEFAULT '0',
	"is_placeholder" boolean DEFAULT false,
	"location" varchar(20) DEFAULT 'remote',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_offers_linked_quote_id_quotes_id_fk') THEN
		ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_linked_quote_id_quotes_id_fk" FOREIGN KEY ("linked_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_invoice_id_invoices_id_fk') THEN
		ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_quote_id_quotes_id_fk') THEN
		ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_roles_id_fk') THEN
		ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_id_roles_id_fk') THEN
		ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_sale_id_sales_id_fk') THEN
		ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_linked_quote_id_quotes_id_fk') THEN
		ALTER TABLE "sales" ADD CONSTRAINT "sales_linked_quote_id_quotes_id_fk" FOREIGN KEY ("linked_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_linked_offer_id_customer_offers_id_fk') THEN
		ALTER TABLE "sales" ADD CONSTRAINT "sales_linked_offer_id_customer_offers_id_fk" FOREIGN KEY ("linked_offer_id") REFERENCES "public"."customer_offers"("id") ON DELETE set null ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_sale_items_sale_id_supplier_sales_id_fk') THEN
		ALTER TABLE "supplier_sale_items" ADD CONSTRAINT "supplier_sale_items_sale_id_supplier_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."supplier_sales"("id") ON DELETE cascade ON UPDATE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_tasks_task_id_tasks_id_fk') THEN
		ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_task_id_tasks_id_fk') THEN
		ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_customer_offers_linked_quote_id" ON "customer_offers" USING btree ("linked_quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_offers_client_id" ON "customer_offers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_offers_status" ON "customer_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_offers_created_at" ON "customer_offers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_client_id" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_status" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_issue_date" ON "invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quotes_client_id" ON "quotes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quotes_status" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quotes_created_at" ON "quotes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_client_id" ON "sales" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_status" ON "sales" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_linked_quote_id" ON "sales" USING btree ("linked_quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_linked_offer_id" ON "sales" USING btree ("linked_offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_sales_linked_offer_id_unique" ON "sales" USING btree ("linked_offer_id") WHERE "sales"."linked_offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_created_at" ON "sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_task_id" ON "time_entries" USING btree ("task_id");
