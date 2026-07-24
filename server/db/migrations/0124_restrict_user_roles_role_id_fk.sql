-- Migration 0124: Tighten user_roles.role_id → roles(id) from ON DELETE CASCADE to RESTRICT.
--
-- Before: deleting a role silently CASCADE-removed any secondary user_roles rows. That made a
-- TOCTOU race possible: an in-use precheck could see the role unused, a concurrent admin could
-- assign it as a secondary role, and the subsequent DELETE would drop that fresh assignment
-- while both operations appeared successful.
--
-- After: deleting a role that still has secondary assignments errors at the FK layer
-- (PG SQLSTATE 23503). The roles DELETE route serializes the lock + in-use check + delete in
-- one transaction and also translates 23503 to a 409 "role in use" response.
--
-- Idempotent: drop both the Drizzle-named and legacy auto-named constraint forms before adding
-- the RESTRICT version, and probe pg_constraint so re-runs on DBs that already match are no-ops.

DO $$ BEGIN
  ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_roles_id_fk";
  ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_fkey";
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_role_id_roles_id_fk' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk"
      FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;
  END IF;
END $$;
