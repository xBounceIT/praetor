-- Bring the `projects.order_id -> sales.id` foreign key under Drizzle's authoritative schema.
-- The historical `schema.sql` baseline creates the FK auto-named `projects_order_id_fkey`;
-- this migration drops that legacy name (if present) and adds the canonical Drizzle name.
DO $$ BEGIN
    ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_order_id_fkey";
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'projects_order_id_sales_id_fk'
    ) THEN
        ALTER TABLE "projects" ADD CONSTRAINT "projects_order_id_sales_id_fk"
            FOREIGN KEY ("order_id") REFERENCES "public"."sales"("id") ON DELETE SET NULL;
    END IF;
END $$;
