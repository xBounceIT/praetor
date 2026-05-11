-- Migration 0025: Align Drizzle migrations with schema.sql parity gaps surfaced by a
-- third-party review.
--
-- Every statement is idempotent so the migration is safe to apply on dev/prod DBs in any
-- prior state — bootstrapped from schema.sql (which already has some of these constraints
-- under auto-generated names), bootstrapped from migrations only, or any partial mix.
--
-- Changes covered, with rationale:
--
--   1. projects.order_id → sales.id FK was declared inline in schema.sql:1116 but never
--      created by 0009_claim_projects. The Drizzle schema intentionally omits the
--      .references() to avoid a circular file import (see comment in schema/projects.ts) —
--      we add the FK here via a hand-written constraint named `fk_projects_order_id` to
--      match the legacy schema.sql shape, so DBs bootstrapped Drizzle-only also get the
--      reference.
--
--   2. idx_tasks_project_id was declared in schema.sql:730 but never modeled in Drizzle.
--      Drizzle generates CREATE INDEX below from schema/tasks.ts; the IF NOT EXISTS guard
--      makes it a no-op on DBs that already created it via the schema.sql baseline.
--
--   3. customer_offer_items.product_id had inconsistent ON DELETE behavior: schema.sql:973
--      had RESTRICT, but 0018 added the canonical FK as SET NULL. Canonical policy across
--      the item-line FKs:
--        • Open documents (quotes, sales/orders, supplier_quotes, supplier_sales,
--          customer_offers): RESTRICT — block deletion of products still referenced by
--          a line item.
--        • Historical/closed documents (invoices, supplier_invoices): SET NULL — preserve
--          the line with a NULL product after the catalog entry is gone.
--      Drop the SET NULL FK and re-add as RESTRICT.
--
--   4. users.role → roles.id was added in 0018 with ON DELETE RESTRICT only. schema.sql:281
--      also sets ON UPDATE CASCADE so renaming a role propagates to user rows. Drop the
--      existing FK and re-add with ON UPDATE CASCADE.
--
--   5. user_roles.role_id used ON DELETE CASCADE in both schema.sql:230 and 0018, which lets
--      a role deletion silently wipe every user/role join row. Switch to ON DELETE RESTRICT
--      so callers must reassign users (or clear the join rows) before dropping the role.

DO $$ BEGIN
    -- 1. projects.order_id → sales.id (ON DELETE SET NULL). Carried forward from schema.sql.
    --    The Drizzle table in schema/projects.ts intentionally omits .references() to avoid
    --    a circular import with sales.ts; projectsRepo still keys off the constraint name
    --    `projects_order_id_fkey` when handling FK violation errors (see
    --    PROJECT_ORDER_FK_CONSTRAINT in projectsRepo.ts). We use the Postgres-default
    --    `<table>_<col>_fkey` naming so DBs bootstrapped from schema.sql (which produced that
    --    auto-name from the inline REFERENCES at schema.sql:1116) skip this no-op, and
    --    Drizzle-only bootstraps end up with the same constraint name.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'projects_order_id_fkey'
    ) THEN
        ALTER TABLE "projects"
            ADD CONSTRAINT "projects_order_id_fkey"
            FOREIGN KEY ("order_id") REFERENCES "public"."sales"("id") ON DELETE SET NULL;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_tasks_project_id" ON "tasks" USING btree ("project_id");
--> statement-breakpoint

DO $$ BEGIN
    -- 3. customer_offer_items.product_id: SET NULL → RESTRICT.
    --    Drop both possible prior names (auto-generated + Drizzle-named) before re-adding so
    --    this stays idempotent regardless of which path bootstrapped the DB.
    ALTER TABLE "customer_offer_items" DROP CONSTRAINT IF EXISTS "customer_offer_items_product_id_fkey";
    ALTER TABLE "customer_offer_items" DROP CONSTRAINT IF EXISTS "customer_offer_items_product_id_products_id_fk";
    ALTER TABLE "customer_offer_items"
        ADD CONSTRAINT "customer_offer_items_product_id_products_id_fk"
        FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;

    -- 4. users.role → roles.id: add ON UPDATE CASCADE.
    ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_fkey";
    ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_roles_id_fk";
    ALTER TABLE "users"
        ADD CONSTRAINT "users_role_roles_id_fk"
        FOREIGN KEY ("role") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    -- 5. user_roles.role_id: CASCADE → RESTRICT.
    ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_fkey";
    ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_roles_id_fk";
    ALTER TABLE "user_roles"
        ADD CONSTRAINT "user_roles_role_id_roles_id_fk"
        FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;
END $$;
