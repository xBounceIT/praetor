-- The built-in admin role is restricted to administration plus the standalone
-- always-available modules granted in code. Remove any previously stored HR
-- module grants from the shipped admin role so it no longer opens HR by
-- default. Custom roles and manager/top_manager HR defaults are untouched.
DELETE FROM role_permissions
WHERE role_id = 'admin'
  AND permission LIKE 'hr.%';
