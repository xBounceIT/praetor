-- Migration 0047: Add ON UPDATE CASCADE to projects.order_id -> sales.id.
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
-- Idempotent: drop the canonical name and the legacy auto-generated one before adding the
-- new version. The probe on `confupdtype = 'c'` (CASCADE) ensures we don't re-add when the
-- updated constraint is already present.
DO $$ BEGIN
    ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_order_id_sales_id_fk";
    ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_order_id_fkey";
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'projects_order_id_sales_id_fk' AND confupdtype = 'c'
    ) THEN
        ALTER TABLE "projects" ADD CONSTRAINT "projects_order_id_sales_id_fk"
            FOREIGN KEY ("order_id") REFERENCES "public"."sales"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
