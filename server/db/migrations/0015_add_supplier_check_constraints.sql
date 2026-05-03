-- Add CHECK constraints to the supplier_invoices/quotes/quote_items tables that exist in
-- schema.sql but were not yet modeled in the tier-4 TS schemas. Pre-existing dev/prod DBs
-- already carry these constraints (under the same names) from schema.sql, so each ADD is
-- guarded by a pg_constraint lookup to make this migration a no-op there. Fresh DBs
-- bootstrapped via Drizzle-kit alone gain the constraints here.

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		WHERE c.contype = 'c'
			AND c.conname = 'supplier_invoices_status_check'
			AND t.relname = 'supplier_invoices'
	) THEN
		ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_status_check" CHECK ("supplier_invoices"."status" IN ('draft', 'sent', 'paid', 'overdue', 'cancelled'));
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		WHERE c.contype = 'c'
			AND c.conname = 'chk_supplier_quote_items_unit_type'
			AND t.relname = 'supplier_quote_items'
	) THEN
		ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "chk_supplier_quote_items_unit_type" CHECK ("supplier_quote_items"."unit_type" IN ('hours', 'days', 'unit'));
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		WHERE c.contype = 'c'
			AND c.conname = 'supplier_quotes_status_check'
			AND t.relname = 'supplier_quotes'
	) THEN
		ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_status_check" CHECK ("supplier_quotes"."status" IN ('received', 'approved', 'rejected', 'draft', 'sent', 'accepted', 'denied'));
	END IF;
END $$;
