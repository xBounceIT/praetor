import { describe, expect, test } from 'bun:test';
import {
  ADMIN_BASE_PERMISSIONS,
  ADMINISTRATION_PERMISSIONS,
  ALL_PERMISSIONS,
  ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS,
  buildPermission,
  buildPermissions,
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  isPermissionKnown,
  isTopManagerOnlyPermission,
  normalizePermission,
  PERMISSION_DEFINITIONS,
  requestHasPermission,
} from '../../utils/permissions.ts';

describe('buildPermission / buildPermissions', () => {
  test('builds a "<resource>.<action>" permission string', () => {
    expect(buildPermission('crm.clients', 'view')).toBe('crm.clients.view');
  });

  test('builds permissions for every action in the list, in order', () => {
    expect(buildPermissions('crm.clients', ['view', 'create', 'update', 'delete'])).toEqual([
      'crm.clients.view',
      'crm.clients.create',
      'crm.clients.update',
      'crm.clients.delete',
    ]);
  });
});

describe('PERMISSION_DEFINITIONS / ALL_PERMISSIONS', () => {
  test('every definition expands into one permission per declared action', () => {
    const expected = PERMISSION_DEFINITIONS.reduce((sum, def) => sum + def.actions.length, 0);
    expect(ALL_PERMISSIONS.length).toBe(expected);
  });

  test('contains expected representative permissions', () => {
    expect(ALL_PERMISSIONS).toContain('crm.clients.view');
    expect(ALL_PERMISSIONS).toContain('hr.work_units.delete');
    expect(ALL_PERMISSIONS).toContain('administration.roles.create');
    expect(ALL_PERMISSIONS).toContain('notifications.delete');
  });

  test('does not contain unknown actions', () => {
    expect(ALL_PERMISSIONS).not.toContain('crm.clients.execute');
  });
});

describe('ADMINISTRATION_PERMISSIONS / ADMIN_BASE_PERMISSIONS', () => {
  test('ADMINISTRATION_PERMISSIONS includes only administration.* entries', () => {
    expect(ADMINISTRATION_PERMISSIONS.every((p) => p.startsWith('administration.'))).toBe(true);
    expect(ADMINISTRATION_PERMISSIONS).toContain('administration.user_management.view');
    expect(ADMINISTRATION_PERMISSIONS).toContain('administration.logs.view');
  });

  test('ADMIN_BASE_PERMISSIONS covers settings, docs, and notifications', () => {
    expect(ADMIN_BASE_PERMISSIONS).toContain('settings.view');
    expect(ADMIN_BASE_PERMISSIONS).toContain('settings.update');
    expect(ADMIN_BASE_PERMISSIONS).toContain('docs.api.view');
    expect(ADMIN_BASE_PERMISSIONS).toContain('docs.frontend.view');
    expect(ADMIN_BASE_PERMISSIONS).toContain('notifications.delete');
  });

  test('ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS covers view/update/delete', () => {
    expect(ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS).toEqual([
      'notifications.view',
      'notifications.update',
      'notifications.delete',
    ]);
  });
});

describe('normalizePermission', () => {
  test('rewrites legacy configuration.* prefix to administration.*', () => {
    expect(normalizePermission('configuration.user_management.view')).toBe(
      'administration.user_management.view',
    );
  });

  test('rewrites legacy suppliers.quotes.* prefix to sales.supplier_quotes.*', () => {
    expect(normalizePermission('suppliers.quotes.create')).toBe('sales.supplier_quotes.create');
  });

  test('returns unrelated permissions unchanged', () => {
    expect(normalizePermission('crm.clients.view')).toBe('crm.clients.view');
  });

  test('does not double-rewrite already-normalized strings', () => {
    expect(normalizePermission('administration.user_management.view')).toBe(
      'administration.user_management.view',
    );
  });
});

describe('isTopManagerOnlyPermission', () => {
  test('matches hr.work_units.* permissions', () => {
    expect(isTopManagerOnlyPermission('hr.work_units.view')).toBe(true);
    expect(isTopManagerOnlyPermission('hr.work_units.delete')).toBe(true);
  });

  test('matches hr.work_units_all.* permissions', () => {
    expect(isTopManagerOnlyPermission('hr.work_units_all.view')).toBe(true);
  });

  test('does not match unrelated hr permissions', () => {
    expect(isTopManagerOnlyPermission('hr.internal.view')).toBe(false);
    expect(isTopManagerOnlyPermission('hr.costs.update')).toBe(false);
  });

  test('does not match permissions in other modules', () => {
    expect(isTopManagerOnlyPermission('crm.clients.view')).toBe(false);
  });
});

describe('isPermissionKnown', () => {
  test('returns true for known permissions', () => {
    expect(isPermissionKnown('crm.clients.view')).toBe(true);
  });

  test('returns true for legacy configuration.* permissions after normalization', () => {
    expect(isPermissionKnown('configuration.user_management.view')).toBe(true);
  });

  test('returns true for legacy suppliers.quotes.* permissions after normalization', () => {
    expect(isPermissionKnown('suppliers.quotes.view')).toBe(true);
  });

  test('returns false for typos and unknown permissions', () => {
    expect(isPermissionKnown('crm.clients.execute')).toBe(false);
    expect(isPermissionKnown('does.not.exist')).toBe(false);
    expect(isPermissionKnown('')).toBe(false);
  });
});

describe('DEFAULT_ROLE_PERMISSIONS', () => {
  test('admin role union covers administration + base + always-granted notifications', () => {
    const adminPerms = DEFAULT_ROLE_PERMISSIONS.admin;
    for (const p of ADMINISTRATION_PERMISSIONS) expect(adminPerms).toContain(p);
    for (const p of ADMIN_BASE_PERMISSIONS) expect(adminPerms).toContain(p);
    for (const p of ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS) expect(adminPerms).toContain(p);
  });

  test('admin role contains no duplicates', () => {
    const adminPerms = DEFAULT_ROLE_PERMISSIONS.admin;
    expect(new Set(adminPerms).size).toBe(adminPerms.length);
  });

  test('manager role does not include hr.work_units.* (top-manager-only)', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.manager.some(isTopManagerOnlyPermission)).toBe(false);
  });

  test('top_manager role includes hr.work_units.* permissions', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.top_manager).toContain('hr.work_units.view');
    expect(DEFAULT_ROLE_PERMISSIONS.top_manager).toContain('hr.work_units.create');
    expect(DEFAULT_ROLE_PERMISSIONS.top_manager).toContain('hr.work_units.delete');
    expect(DEFAULT_ROLE_PERMISSIONS.top_manager).toContain('hr.work_units_all.view');
  });

  test('user role is restricted to timesheets, project read-only, settings, docs', () => {
    const userPerms = DEFAULT_ROLE_PERMISSIONS.user;
    expect(userPerms).toContain('timesheets.tracker.view');
    expect(userPerms).toContain('timesheets.tracker.create');
    expect(userPerms).toContain('projects.manage.view');
    expect(userPerms).toContain('settings.view');
    expect(userPerms).toContain('docs.api.view');
    expect(userPerms).not.toContain('crm.clients.view');
    expect(userPerms).not.toContain('hr.work_units.view');
    expect(userPerms).not.toContain('administration.roles.view');
  });

  test('user role does not include any administration.* permissions', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.user.some((p) => p.startsWith('administration.'))).toBe(false);
  });
});

describe('hasPermission', () => {
  test('returns true when the array contains the permission', () => {
    expect(hasPermission(['crm.clients.view', 'crm.clients.update'], 'crm.clients.view')).toBe(
      true,
    );
  });

  test('returns false when the permission is missing', () => {
    expect(hasPermission(['crm.clients.view'], 'crm.clients.delete')).toBe(false);
  });

  test('returns false for undefined permissions', () => {
    expect(hasPermission(undefined, 'crm.clients.view')).toBe(false);
  });

  test('returns false for empty array', () => {
    expect(hasPermission([], 'crm.clients.view')).toBe(false);
  });
});

describe('requestHasPermission', () => {
  test('returns true when request.user.permissions contains the permission', () => {
    const request = { user: { permissions: ['crm.clients.view'] } };
    expect(requestHasPermission(request, 'crm.clients.view')).toBe(true);
  });

  test('returns false when request has no user', () => {
    expect(requestHasPermission({}, 'crm.clients.view')).toBe(false);
  });

  test('returns false when user has no permissions field', () => {
    expect(requestHasPermission({ user: {} }, 'crm.clients.view')).toBe(false);
  });

  test('returns false when permission is not in the list', () => {
    const request = { user: { permissions: ['crm.clients.update'] } };
    expect(requestHasPermission(request, 'crm.clients.view')).toBe(false);
  });
});
