-- Migration 0018: Bring all remaining tables, foreign keys, and CHECK constraints under
-- Drizzle's authoritative schema.
--
-- This migration is idempotent: every CREATE TABLE / CREATE INDEX uses IF NOT EXISTS, and
-- every ADD CONSTRAINT is wrapped in a DO block that probes pg_constraint first. Dev DBs
-- that already have the schema.sql baseline applied will see most ADD CONSTRAINT statements
-- skipped; fresh DBs (Drizzle-only bootstrap) get the constraints freshly created.
--
-- We also DROP IF EXISTS the auto-generated `<table>_<column>_fkey` and legacy CHECK names
-- so dev DBs end up with one canonical Drizzle-named copy rather than the original + a
-- duplicate. This is safe in this codebase per the migration plan ("no live instance —
-- ensure maximum Drizzle migration").

-- =============================================================================
-- 1. New join tables (user_clients, user_projects). user_tasks already exists in
--    schema.sql; userTasks was already modeled in TS and only gains a CHECK + a user_id FK.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "user_clients" (
	"user_id" varchar(50) NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"assignment_source" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "user_clients_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_projects" (
	"user_id" varchar(50) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"assignment_source" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "user_projects_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint

-- =============================================================================
-- 2. Foreign keys. Drop any pre-existing auto-generated `_fkey` versions, then add the
--    canonical Drizzle-named version if it isn't already there.
-- =============================================================================

DO $$ BEGIN
	-- user_clients
	ALTER TABLE "user_clients" DROP CONSTRAINT IF EXISTS "user_clients_user_id_fkey";
	ALTER TABLE "user_clients" DROP CONSTRAINT IF EXISTS "user_clients_client_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_clients_user_id_users_id_fk') THEN
		ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_clients_client_id_clients_id_fk') THEN
		ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;

	-- user_projects
	ALTER TABLE "user_projects" DROP CONSTRAINT IF EXISTS "user_projects_user_id_fkey";
	ALTER TABLE "user_projects" DROP CONSTRAINT IF EXISTS "user_projects_project_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_projects_user_id_users_id_fk') THEN
		ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_projects_project_id_projects_id_fk') THEN
		ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_project_id_projects_id_fk"
			FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
	END IF;

	-- audit_logs.user_id
	ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_users_id_fk') THEN
		ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;

	-- customer_offer_items.product_id
	ALTER TABLE "customer_offer_items" DROP CONSTRAINT IF EXISTS "customer_offer_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_offer_items_product_id_products_id_fk') THEN
		ALTER TABLE "customer_offer_items" ADD CONSTRAINT "customer_offer_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;
	END IF;

	-- customer_offers.client_id (linked_quote_id FK already modeled, leave alone)
	ALTER TABLE "customer_offers" DROP CONSTRAINT IF EXISTS "customer_offers_client_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_offers_client_id_clients_id_fk') THEN
		ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;

	-- invoice_items.product_id
	ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_product_id_products_id_fk') THEN
		ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;
	END IF;

	-- invoices.linked_sale_id, invoices.client_id
	ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_linked_sale_id_fkey";
	ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_client_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_linked_sale_id_sales_id_fk') THEN
		ALTER TABLE "invoices" ADD CONSTRAINT "invoices_linked_sale_id_sales_id_fk"
			FOREIGN KEY ("linked_sale_id") REFERENCES "public"."sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_client_id_clients_id_fk') THEN
		ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;

	-- notifications.user_id
	ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_users_id_fk') THEN
		ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;

	-- projects.client_id
	ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_client_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_client_id_clients_id_fk') THEN
		ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;

	-- quote_items.product_id
	ALTER TABLE "quote_items" DROP CONSTRAINT IF EXISTS "quote_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_product_id_products_id_fk') THEN
		ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;
	END IF;

	-- quotes.client_id
	ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_client_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_client_id_clients_id_fk') THEN
		ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;

	-- report_chat_sessions.user_id
	ALTER TABLE "report_chat_sessions" DROP CONSTRAINT IF EXISTS "report_chat_sessions_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_chat_sessions_user_id_users_id_fk') THEN
		ALTER TABLE "report_chat_sessions" ADD CONSTRAINT "report_chat_sessions_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;

	-- user_roles.user_id (role_id FK already modeled, leave alone)
	ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_users_id_fk') THEN
		ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;

	-- sale_items.product_id
	ALTER TABLE "sale_items" DROP CONSTRAINT IF EXISTS "sale_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_product_id_products_id_fk') THEN
		ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;
	END IF;

	-- sales.client_id (linked_quote_id, linked_offer_id FKs already modeled, leave alone)
	ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_client_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_client_id_clients_id_fk') THEN
		ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;

	-- settings.user_id
	ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_user_id_users_id_fk') THEN
		ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;

	-- supplier_invoice_items.product_id
	ALTER TABLE "supplier_invoice_items" DROP CONSTRAINT IF EXISTS "supplier_invoice_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoice_items_product_id_products_id_fk') THEN
		ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;
	END IF;

	-- supplier_quote_items.product_id
	ALTER TABLE "supplier_quote_items" DROP CONSTRAINT IF EXISTS "supplier_quote_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quote_items_product_id_products_id_fk') THEN
		ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;
	END IF;

	-- supplier_sale_items.product_id
	ALTER TABLE "supplier_sale_items" DROP CONSTRAINT IF EXISTS "supplier_sale_items_product_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_sale_items_product_id_products_id_fk') THEN
		ALTER TABLE "supplier_sale_items" ADD CONSTRAINT "supplier_sale_items_product_id_products_id_fk"
			FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;
	END IF;

	-- supplier_sales.linked_quote_id, supplier_sales.supplier_id
	ALTER TABLE "supplier_sales" DROP CONSTRAINT IF EXISTS "supplier_sales_linked_quote_id_fkey";
	ALTER TABLE "supplier_sales" DROP CONSTRAINT IF EXISTS "supplier_sales_supplier_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_sales_linked_quote_id_supplier_quotes_id_fk') THEN
		ALTER TABLE "supplier_sales" ADD CONSTRAINT "supplier_sales_linked_quote_id_supplier_quotes_id_fk"
			FOREIGN KEY ("linked_quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_sales_supplier_id_suppliers_id_fk') THEN
		ALTER TABLE "supplier_sales" ADD CONSTRAINT "supplier_sales_supplier_id_suppliers_id_fk"
			FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;
	END IF;

	-- tasks.project_id
	ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_project_id_projects_id_fk') THEN
		ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk"
			FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
	END IF;

	-- user_tasks.user_id (task_id FK already modeled)
	ALTER TABLE "user_tasks" DROP CONSTRAINT IF EXISTS "user_tasks_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_tasks_user_id_users_id_fk') THEN
		ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;

	-- time_entries.user_id, time_entries.client_id, time_entries.project_id
	-- (task_id FK already modeled with ON DELETE SET NULL)
	ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_user_id_fkey";
	ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_client_id_fkey";
	ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_project_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_user_id_users_id_fk') THEN
		ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_client_id_clients_id_fk') THEN
		ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk"
			FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_project_id_projects_id_fk') THEN
		ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk"
			FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
	END IF;

	-- users.role
	ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_roles_id_fk') THEN
		ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_id_fk"
			FOREIGN KEY ("role") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;
	END IF;

	-- user_work_units.user_id, user_work_units.work_unit_id
	ALTER TABLE "user_work_units" DROP CONSTRAINT IF EXISTS "user_work_units_user_id_fkey";
	ALTER TABLE "user_work_units" DROP CONSTRAINT IF EXISTS "user_work_units_work_unit_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_work_units_user_id_users_id_fk') THEN
		ALTER TABLE "user_work_units" ADD CONSTRAINT "user_work_units_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_work_units_work_unit_id_work_units_id_fk') THEN
		ALTER TABLE "user_work_units" ADD CONSTRAINT "user_work_units_work_unit_id_work_units_id_fk"
			FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE CASCADE;
	END IF;

	-- work_unit_managers.work_unit_id, work_unit_managers.user_id
	ALTER TABLE "work_unit_managers" DROP CONSTRAINT IF EXISTS "work_unit_managers_work_unit_id_fkey";
	ALTER TABLE "work_unit_managers" DROP CONSTRAINT IF EXISTS "work_unit_managers_user_id_fkey";
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_unit_managers_work_unit_id_work_units_id_fk') THEN
		ALTER TABLE "work_unit_managers" ADD CONSTRAINT "work_unit_managers_work_unit_id_work_units_id_fk"
			FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_unit_managers_user_id_users_id_fk') THEN
		ALTER TABLE "work_unit_managers" ADD CONSTRAINT "work_unit_managers_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
	END IF;
END $$;
--> statement-breakpoint

-- =============================================================================
-- 3. Indexes that drizzle-kit emits because they're newly listed in the TS schema. Most
--    already exist in schema.sql; CREATE INDEX IF NOT EXISTS makes the migration idempotent.
-- =============================================================================

CREATE INDEX IF NOT EXISTS "idx_invoice_items_invoice_id" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quote_items_quote_id" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_items_sale_id" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_items_supplier_sale_id" ON "sale_items" USING btree ("supplier_sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_sale_items_sale_id" ON "supplier_sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_sales_supplier_id" ON "supplier_sales" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_sales_status" ON "supplier_sales" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supplier_sales_linked_quote_id" ON "supplier_sales" USING btree ("linked_quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_user_id" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_date" ON "time_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_project_id" ON "time_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_created_at_id" ON "time_entries" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_user_id_created_at_id" ON "time_entries" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint

-- =============================================================================
-- 4. CHECK constraints. Many already exist in schema.sql under the same canonical names;
--    others are inline anonymous CHECKs that Postgres auto-named `<table>_<col>_check`. We
--    DROP IF EXISTS first (no-op when absent), then ADD with the canonical name. The whole
--    DO block is one transaction, so a partial failure rolls back. Re-running this migration
--    is prevented by `__drizzle_migrations`; idempotency here is about handling DBs that
--    already have the constraints applied via the schema.sql baseline.
-- =============================================================================

DO $$ BEGIN
	-- customer_offers
	ALTER TABLE "customer_offers" DROP CONSTRAINT IF EXISTS "customer_offers_status_check";
	ALTER TABLE "customer_offers" DROP CONSTRAINT IF EXISTS "chk_customer_offers_discount_type";
	ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_status_check"
		CHECK ("customer_offers"."status" IN ('draft', 'sent', 'accepted', 'denied'));
	ALTER TABLE "customer_offers" ADD CONSTRAINT "chk_customer_offers_discount_type"
		CHECK ("customer_offers"."discount_type" IN ('percentage', 'currency'));

	-- email_config (single-row id=1)
	ALTER TABLE "email_config" DROP CONSTRAINT IF EXISTS "email_config_id_check";
	ALTER TABLE "email_config" DROP CONSTRAINT IF EXISTS "email_config_id_check1";
	ALTER TABLE "email_config" ADD CONSTRAINT "email_config_id_check" CHECK ("email_config"."id" = 1);

	-- general_settings
	ALTER TABLE "general_settings" DROP CONSTRAINT IF EXISTS "general_settings_id_check";
	ALTER TABLE "general_settings" DROP CONSTRAINT IF EXISTS "general_settings_id_check1";
	ALTER TABLE "general_settings" DROP CONSTRAINT IF EXISTS "general_settings_start_of_week_check";
	ALTER TABLE "general_settings" DROP CONSTRAINT IF EXISTS "general_settings_ai_provider_check";
	ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_id_check" CHECK ("general_settings"."id" = 1);
	ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_start_of_week_check"
		CHECK ("general_settings"."start_of_week" IN ('Monday', 'Sunday'));
	ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_ai_provider_check"
		CHECK ("general_settings"."ai_provider" IN ('gemini', 'openrouter'));

	-- invoices
	ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_status_check";
	ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check"
		CHECK ("invoices"."status" IN ('draft', 'sent', 'paid', 'overdue', 'cancelled'));

	-- ldap_config (single-row id=1)
	ALTER TABLE "ldap_config" DROP CONSTRAINT IF EXISTS "ldap_config_id_check";
	ALTER TABLE "ldap_config" ADD CONSTRAINT "ldap_config_id_check" CHECK ("ldap_config"."id" = 1);

	-- quote_items unit_type
	ALTER TABLE "quote_items" DROP CONSTRAINT IF EXISTS "chk_quote_items_unit_type";
	ALTER TABLE "quote_items" ADD CONSTRAINT "chk_quote_items_unit_type"
		CHECK ("quote_items"."unit_type" IN ('hours', 'days', 'unit'));

	-- quotes
	ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_status_check";
	ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "chk_quotes_discount_type";
	ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status_check"
		CHECK ("quotes"."status" IN ('quoted', 'confirmed', 'draft', 'sent', 'accepted', 'denied'));
	ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_discount_type"
		CHECK ("quotes"."discount_type" IN ('percentage', 'currency'));

	-- report_chat_messages
	ALTER TABLE "report_chat_messages" DROP CONSTRAINT IF EXISTS "report_chat_messages_role_check";
	ALTER TABLE "report_chat_messages" ADD CONSTRAINT "report_chat_messages_role_check"
		CHECK ("report_chat_messages"."role" IN ('user', 'assistant'));

	-- sale_items unit_type
	ALTER TABLE "sale_items" DROP CONSTRAINT IF EXISTS "chk_sale_items_unit_type";
	ALTER TABLE "sale_items" ADD CONSTRAINT "chk_sale_items_unit_type"
		CHECK ("sale_items"."unit_type" IN ('hours', 'days', 'unit'));

	-- sales
	ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_status_check";
	ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "chk_sales_discount_type";
	ALTER TABLE "sales" ADD CONSTRAINT "sales_status_check"
		CHECK ("sales"."status" IN ('draft', 'confirmed', 'denied'));
	ALTER TABLE "sales" ADD CONSTRAINT "chk_sales_discount_type"
		CHECK ("sales"."discount_type" IN ('percentage', 'currency'));

	-- settings
	ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_language_check";
	ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_start_of_week_check";
	ALTER TABLE "settings" ADD CONSTRAINT "settings_language_check"
		CHECK ("settings"."language" IN ('en', 'it', 'auto'));
	ALTER TABLE "settings" ADD CONSTRAINT "settings_start_of_week_check"
		CHECK ("settings"."start_of_week" IN ('Monday', 'Sunday'));

	-- supplier_sales
	ALTER TABLE "supplier_sales" DROP CONSTRAINT IF EXISTS "supplier_sales_status_check";
	ALTER TABLE "supplier_sales" DROP CONSTRAINT IF EXISTS "chk_supplier_sales_discount_type";
	ALTER TABLE "supplier_sales" ADD CONSTRAINT "supplier_sales_status_check"
		CHECK ("supplier_sales"."status" IN ('draft', 'sent'));
	ALTER TABLE "supplier_sales" ADD CONSTRAINT "chk_supplier_sales_discount_type"
		CHECK ("supplier_sales"."discount_type" IN ('percentage', 'currency'));

	-- user_clients / user_projects / user_tasks assignment_source
	ALTER TABLE "user_clients" DROP CONSTRAINT IF EXISTS "user_clients_assignment_source_check";
	ALTER TABLE "user_projects" DROP CONSTRAINT IF EXISTS "user_projects_assignment_source_check";
	ALTER TABLE "user_tasks" DROP CONSTRAINT IF EXISTS "user_tasks_assignment_source_check";
	ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_assignment_source_check"
		CHECK ("user_clients"."assignment_source" IN ('manual', 'top_manager_auto', 'project_cascade'));
	ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_assignment_source_check"
		CHECK ("user_projects"."assignment_source" IN ('manual', 'top_manager_auto', 'project_cascade'));
	ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_assignment_source_check"
		CHECK ("user_tasks"."assignment_source" IN ('manual', 'top_manager_auto', 'project_cascade'));

	-- time_entries.location
	ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_location_check";
	ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_check"
		CHECK ("time_entries"."location" IN ('remote', 'office', 'customer_premise', 'transfer'));

	-- users.employee_type
	ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_employee_type_check";
	ALTER TABLE "users" ADD CONSTRAINT "users_employee_type_check"
		CHECK ("users"."employee_type" IN ('app_user', 'internal', 'external'));
END $$;
