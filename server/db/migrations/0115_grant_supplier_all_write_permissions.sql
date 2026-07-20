-- Preserve the effective global supplier write access of roles that were already trusted
-- with both the full supplier directory and the corresponding legacy base write action.
-- Roles without crm.suppliers_all.view are intentionally not promoted.
INSERT INTO role_permissions (role_id, permission)
SELECT DISTINCT base.role_id, grants.all_permission
FROM (
  VALUES
    ('crm.suppliers.update', 'crm.suppliers_all.update'),
    ('crm.suppliers.delete', 'crm.suppliers_all.delete')
) AS grants(base_permission, all_permission)
JOIN role_permissions AS base
  ON base.permission = grants.base_permission
JOIN role_permissions AS full_scope
  ON full_scope.role_id = base.role_id
 AND full_scope.permission = 'crm.suppliers_all.view'
ON CONFLICT DO NOTHING;
