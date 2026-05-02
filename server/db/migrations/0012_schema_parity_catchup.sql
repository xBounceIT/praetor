-- Schema parity catch-up for the tier-3 claim migrations (0006-0011). Each statement is
-- guarded so this is a no-op on existing dev/prod DBs that already have the post-ALTER
-- shape from schema.sql, while still bringing fresh DBs into parity with the live schema.
--
-- 1) Clients column widening: schema.sql widens sector/number_of_employees/revenue/
--    office_count_range to varchar(120) via ALTER COLUMN TYPE. The 0011 CREATE TABLE
--    declared the legacy narrow widths; this catches up so a fresh-DB shape matches.
-- 2) Clients functional unique indexes: schema.sql defines idx_clients_fiscal_code_unique
--    (LOWER, partial) and idx_clients_client_code_unique (partial), and drops the legacy
--    idx_clients_vat_number_unique that predates the rename to fiscal_code. Without these,
--    findByFiscalCode/findByClientCode have no DB-level race-safety on a fresh DB.
-- 3) Suppliers/projects/users carry-forward ADD COLUMN IF NOT EXISTS for columns that
--    schema.sql adds via ALTER. DBs bootstrapped from a schema.sql revision predating
--    each inline column would otherwise miss the column on the 0006/0009/0010 path.

ALTER TABLE "clients" ALTER COLUMN "sector" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "number_of_employees" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "revenue" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "office_count_range" SET DATA TYPE varchar(120);--> statement-breakpoint
DROP INDEX IF EXISTS "idx_clients_vat_number_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_clients_fiscal_code_unique" ON "clients" USING btree (LOWER("fiscal_code")) WHERE "clients"."fiscal_code" IS NOT NULL AND "clients"."fiscal_code" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_clients_client_code_unique" ON "clients" USING btree ("client_code") WHERE "clients"."client_code" IS NOT NULL AND "clients"."client_code" <> '';--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_disabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "supplier_code" varchar(50);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "contact_name" varchar(255);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "email" varchar(255);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "phone" varchar(50);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "vat_number" varchar(50);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tax_code" varchar(50);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payment_terms" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_disabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cost_per_hour" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_disabled" boolean DEFAULT false;
