DELETE FROM role_permissions
WHERE permission IN ('hr.internal.create', 'hr.internal.delete');
