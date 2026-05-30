-- Add the `projects.assignments.view` permission and grant it by default to the
-- manager and top_manager roles. This makes "view project assignments" a role-agnostic
-- capability: any role holding it can load a project/activity assignment dialog
-- regardless of per-entity membership (issue #720 — a Top Manager who removed themselves
-- from an activity could no longer open its "Assegna Utenti" dialog).
--
-- Idempotent: ON CONFLICT DO NOTHING absorbs re-runs and any prior manual grant. The
-- INSERT...SELECT form skips roles that don't exist yet — the Drizzle-only fresh-DB path
-- (`bun run db:migrate` against an empty schema) doesn't seed the system roles, so a literal
-- VALUES list would violate the role_id FK. Mirrors 0055_reseed_hr_cost_permissions.sql.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM (VALUES
    ('manager', 'projects.assignments.view'),
    ('top_manager', 'projects.assignments.view')
) AS p(role_id, permission)
JOIN roles r ON r.id = p.role_id
ON CONFLICT DO NOTHING;
