-- Migration 0033: Tighten ON DELETE on financial-document → client/supplier FKs from CASCADE
-- to RESTRICT.
--
-- Before: deleting a client silently destroyed all invoices/quotes/offers/sales referencing it
-- (and the same for supplier-side docs vs suppliers). That violated typical accounting/audit
-- expectations — once a financial document is issued, it should not vanish just because the
-- counterparty record is removed.
--
-- After: deleting a client/supplier with any dependent financial document errors at the FK
-- layer (PG SQLSTATE 23503). The clients/suppliers DELETE routes catch this and translate it
-- to a 409 with a "has financial documents" message so the UI can surface a clean error.
--
-- Idempotent: each constraint is dropped IF EXISTS before being added, and we probe
-- pg_constraint so dev DBs that already have the canonical Drizzle-named constraint don't
-- collide. Some DBs may carry the legacy auto-generated `<table>_<column>_fkey` name from
-- schema.sql bootstrap; we drop both forms before adding the new RESTRICT version.

DO $$ BEGIN
  -- customer_offers.client_id
  ALTER TABLE "customer_offers" DROP CONSTRAINT IF EXISTS "customer_offers_client_id_clients_id_fk";
  ALTER TABLE "customer_offers" DROP CONSTRAINT IF EXISTS "customer_offers_client_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_offers_client_id_clients_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_client_id_clients_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;
  END IF;

  -- invoices.client_id
  ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_client_id_clients_id_fk";
  ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_client_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_client_id_clients_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;
  END IF;

  -- quotes.client_id
  ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_client_id_clients_id_fk";
  ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_client_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotes_client_id_clients_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;
  END IF;

  -- sales.client_id
  ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_client_id_clients_id_fk";
  ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_client_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_client_id_clients_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;
  END IF;

  -- supplier_invoices.supplier_id
  ALTER TABLE "supplier_invoices" DROP CONSTRAINT IF EXISTS "supplier_invoices_supplier_id_suppliers_id_fk";
  ALTER TABLE "supplier_invoices" DROP CONSTRAINT IF EXISTS "supplier_invoices_supplier_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_invoices_supplier_id_suppliers_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk"
      FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;
  END IF;

  -- supplier_quotes.supplier_id
  ALTER TABLE "supplier_quotes" DROP CONSTRAINT IF EXISTS "supplier_quotes_supplier_id_suppliers_id_fk";
  ALTER TABLE "supplier_quotes" DROP CONSTRAINT IF EXISTS "supplier_quotes_supplier_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_quotes_supplier_id_suppliers_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_id_suppliers_id_fk"
      FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;
  END IF;

  -- supplier_sales.supplier_id
  ALTER TABLE "supplier_sales" DROP CONSTRAINT IF EXISTS "supplier_sales_supplier_id_suppliers_id_fk";
  ALTER TABLE "supplier_sales" DROP CONSTRAINT IF EXISTS "supplier_sales_supplier_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_sales_supplier_id_suppliers_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "supplier_sales" ADD CONSTRAINT "supplier_sales_supplier_id_suppliers_id_fk"
      FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;
  END IF;
END $$;
