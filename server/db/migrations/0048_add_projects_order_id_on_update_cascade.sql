-- Migration 0048: Add ON UPDATE CASCADE to projects.order_id -> sales.id.
--
-- Before: the FK only declared ON DELETE SET NULL (added in 0037). ON UPDATE defaulted to
-- NO ACTION, so renaming a sales.id (PUT /api/clients-orders/:id accepts a new `id` and
-- validates it via `findIdConflict`) failed with a FK violation whenever a project was
-- linked to that order, while the rest of the sales.id FK chain (sale_items, invoices,
-- order_versions) all cascaded the rename.
--
-- After: renaming an order ID propagates through projects.order_id as well, keeping the
-- chain consistent. ON DELETE SET NULL is preserved.
--
-- Idempotent: the probe on `confupdtype = 'c'` (CASCADE) gates the entire drop+add block
-- so a replay against a DB that already has the correct constraint is a true no-op (no
-- DDL, no ACCESS EXCLUSIVE lock acquired on projects/sales). The inner DROPs handle the
-- two states that still need fixing: the canonical name present without CASCADE (from
-- migration 0037), or the legacy auto-generated name from the pre-Drizzle schema.sql.
-- The probe is scoped on `conrelid` / `confrelid` so an unrelated constraint with the
-- same name on another table can't mask the FK we actually care about
-- (`pg_constraint.conname` is unique only within (table, namespace), not globally).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'projects_order_id_sales_id_fk'
          AND conrelid = 'public.projects'::regclass
          AND confrelid = 'public.sales'::regclass
          AND confupdtype = 'c'
    ) THEN
        ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_order_id_sales_id_fk";
        ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_order_id_fkey";
        ALTER TABLE "projects" ADD CONSTRAINT "projects_order_id_sales_id_fk"
            FOREIGN KEY ("order_id") REFERENCES "public"."sales"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
