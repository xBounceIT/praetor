-- Ensure the shipped Top Manager role has every Competence Center permission.
-- Earlier defaults granted hr.work_units CRUD plus hr.work_units_all.view; the
-- scope resource also defines create/update/delete, so grant the full pair.
--
-- Idempotent: ON CONFLICT DO NOTHING absorbs re-runs and prior manual grants.
-- JOIN roles skips Drizzle-only fresh databases that have not seeded system
-- roles yet, matching the existing default-permission migrations.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM (VALUES
    ('top_manager', 'hr.work_units.view'),
    ('top_manager', 'hr.work_units.create'),
    ('top_manager', 'hr.work_units.update'),
    ('top_manager', 'hr.work_units.delete'),
    ('top_manager', 'hr.work_units_all.view'),
    ('top_manager', 'hr.work_units_all.create'),
    ('top_manager', 'hr.work_units_all.update'),
    ('top_manager', 'hr.work_units_all.delete')
) AS p(role_id, permission)
JOIN roles r ON r.id = p.role_id
ON CONFLICT DO NOTHING;
