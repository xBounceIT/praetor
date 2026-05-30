-- Grant `reports.cost.view` to the default `manager` and `top_manager` roles.
-- This is the dedicated permission that gates all monetary cost figures
-- (project cost-vs-revenue chart, Total Cost / Budget KPIs, cost columns on
-- time entries and reports) on both the client and the server. Managers and
-- top managers already hold the HR cost permissions (hr.costs / hr.costs_all)
-- and are expected to see project cost out of the box, so add the matching
-- analytics-cost grant to the shipped defaults.
--
-- Idempotent: ON CONFLICT DO NOTHING absorbs re-runs and any prior manual
-- grant from the Roles UI. The INSERT...SELECT form JOINs `roles`, so it
-- silently skips roles that don't exist yet — mirroring 0055, this keeps the
-- Drizzle-only fresh-DB path (which doesn't seed the system roles) from
-- violating the role_id FK, while the schema.sql fresh-install path (which
-- seeds the roles before migrations run) still receives the grant.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM (VALUES
    ('manager', 'reports.cost.view'),
    ('top_manager', 'reports.cost.view')
) AS p(role_id, permission)
JOIN roles r ON r.id = p.role_id
ON CONFLICT DO NOTHING;
