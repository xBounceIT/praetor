-- Tighten the default Manager and Top Manager roles so they can no longer
-- create or delete internal users (employee_type = 'internal'). The create/
-- delete user routes gate the 'internal' employee type behind
-- hr.internal.create / hr.internal.delete, so removing those grants leaves the
-- two system roles able to view and update existing internal employees while
-- creation and deletion become admin-only.
--
-- On fresh installs the schema.sql bootstrap seeds 'manager' with the full
-- hr.internal CRUD set and 'top_manager' inherits it via the manager-baseline
-- copy, so this DELETE realigns both the legacy bootstrap and any DB that was
-- created from it. hr.internal.view / hr.internal.update and the entire
-- hr.external.* set are intentionally preserved. Idempotent: re-running deletes
-- nothing once the rows are gone, and DELETE silently no-ops on the
-- Drizzle-only fresh-DB path where the system roles aren't seeded yet.
--
-- Admins who explicitly want a Manager or Top Manager to create or delete
-- internal users can re-add the grants from the Roles UI.
DELETE FROM role_permissions
WHERE role_id IN ('manager', 'top_manager')
  AND permission IN ('hr.internal.create', 'hr.internal.delete');
