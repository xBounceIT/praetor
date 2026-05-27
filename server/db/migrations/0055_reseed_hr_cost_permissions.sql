-- Split the legacy `hr.costs` permission into a scoped pair:
--   hr.costs_all.view / hr.costs_all.update -> all-users cost access
--   hr.costs.update                          -> personal-cost-only edit
-- and reseed defaults so manager can edit own cost while top_manager retains
-- full cost access. Mirrors the rename pattern used for sales.supplier_offers
-- in the historical schema.sql.

-- Rename legacy "view all" grants to the new scoped name.
UPDATE role_permissions
SET permission = 'hr.costs_all.view'
WHERE permission = 'hr.costs.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = role_permissions.role_id
      AND rp2.permission = 'hr.costs_all.view'
  );
DELETE FROM role_permissions WHERE permission = 'hr.costs.view';

-- Rename legacy "edit all" grants to the new scoped name. The literal
-- 'hr.costs.update' is then free to be re-introduced below with the new
-- personal-only meaning.
UPDATE role_permissions
SET permission = 'hr.costs_all.update'
WHERE permission = 'hr.costs.update'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = role_permissions.role_id
      AND rp2.permission = 'hr.costs_all.update'
  );
DELETE FROM role_permissions WHERE permission = 'hr.costs.update';

-- Realign the system 'manager' role to the new policy: managers may view all
-- costs but only edit their own. On fresh installs the schema.sql bootstrap
-- seeds manager with the legacy hr.costs.update grant, which the rename above
-- promotes into hr.costs_all.update — strip it here so the default never lets a
-- manager edit other users' costs. Custom non-system roles keep whatever the
-- rename produced; admins who explicitly want to grant manager hr.costs_all.update
-- can re-add it via the Roles UI.
DELETE FROM role_permissions
WHERE role_id = 'manager' AND permission = 'hr.costs_all.update';

-- Seed the new defaults. Idempotent: ON CONFLICT DO NOTHING absorbs both
-- re-runs and any prior manual grants.
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'hr.costs_all.view'),
    ('manager', 'hr.costs.update'),
    ('top_manager', 'hr.costs_all.view'),
    ('top_manager', 'hr.costs_all.update'),
    ('top_manager', 'hr.costs.update')
ON CONFLICT DO NOTHING;
