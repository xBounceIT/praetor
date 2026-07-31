-- Top Managers can already view every user's tracker through tracker_all.view. Grant the
-- matching global write actions so selecting a user outside their competence centers does not
-- fail after the UI has legitimately exposed that user. Keep the complete CRUD set here to make
-- the shipped role's intended scope explicit and to repair databases where only view was seeded.
--
-- JOIN roles keeps the migration safe for Drizzle-only schemas where system roles have not been
-- bootstrapped yet. ON CONFLICT makes replays and databases with prior manual grants no-ops.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM (VALUES
    ('top_manager', 'timesheets.tracker_all.view'),
    ('top_manager', 'timesheets.tracker_all.create'),
    ('top_manager', 'timesheets.tracker_all.update'),
    ('top_manager', 'timesheets.tracker_all.delete')
) AS p(role_id, permission)
JOIN roles r ON r.id = p.role_id
ON CONFLICT DO NOTHING;
