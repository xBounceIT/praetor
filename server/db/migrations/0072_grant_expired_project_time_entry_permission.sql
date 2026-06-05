-- Grant the dedicated expired-project time-entry override to shipped manager roles.
-- The permission only bypasses project expiry; normal tracker create scope and
-- target-user assignment checks still apply in the service layer.
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'timesheets.expired_projects.create'),
    ('top_manager', 'timesheets.expired_projects.create')
ON CONFLICT DO NOTHING;
