-- Grant the dedicated expired-project time-entry override to shipped manager roles.
-- The permission only bypasses project expiry; normal tracker create scope and
-- target-user assignment checks still apply in the service layer.
INSERT INTO role_permissions (role_id, permission)
SELECT roles.id, 'timesheets.expired_projects.create'
FROM roles
WHERE roles.id IN ('manager', 'top_manager')
ON CONFLICT DO NOTHING;
