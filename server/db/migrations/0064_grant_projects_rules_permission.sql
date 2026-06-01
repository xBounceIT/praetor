-- Grant project-rule CRUD permissions to the shipped manager and top_manager roles.
-- Idempotent and FK-safe for Drizzle-only fresh DBs where roles may not be seeded yet.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM (VALUES
    ('manager', 'projects.rules.view'),
    ('manager', 'projects.rules.create'),
    ('manager', 'projects.rules.update'),
    ('manager', 'projects.rules.delete'),
    ('top_manager', 'projects.rules.view'),
    ('top_manager', 'projects.rules.create'),
    ('top_manager', 'projects.rules.update'),
    ('top_manager', 'projects.rules.delete')
) AS p(role_id, permission)
JOIN roles r ON r.id = p.role_id
ON CONFLICT DO NOTHING;
