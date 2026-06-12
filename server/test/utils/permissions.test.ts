import { describe, expect, mock, test } from 'bun:test';
import {
  ADMIN_BASE_PERMISSIONS,
  ADMINISTRATION_PERMISSIONS,
  ALL_PERMISSIONS,
  ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS,
  buildPermission,
  buildPermissions,
  equivalentPermissionsFor,
  hasAnyPermission,
  hasPermission,
  hasScopedActionPermission,
  isPermissionKnown,
  isTopManagerOnlyPermission,
  makeAccessChecker,
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
    expect(ALL_PERMISSIONS).toContain('crm.clients_all.create');
    expect(ALL_PERMISSIONS).toContain('crm.suppliers_all.update');
    expect(ALL_PERMISSIONS).toContain('projects.manage_all.delete');
    expect(ALL_PERMISSIONS).toContain('projects.tasks_all.create');
    expect(ALL_PERMISSIONS).toContain('timesheets.ril.view');
    expect(ALL_PERMISSIONS).toContain('projects.rules.view');
    expect(ALL_PERMISSIONS).toContain('projects.rules.create');
    expect(ALL_PERMISSIONS).toContain('projects.rules.update');
    expect(ALL_PERMISSIONS).toContain('projects.rules.delete');
    expect(ALL_PERMISSIONS).toContain('timesheets.tracker_all.update');
    expect(ALL_PERMISSIONS).toContain('timesheets.expired_projects.create');
    expect(ALL_PERMISSIONS).toContain('hr.work_units.delete');
    expect(ALL_PERMISSIONS).toContain('hr.work_units_all.delete');
    expect(ALL_PERMISSIONS).toContain('hr.costs.view');
    expect(ALL_PERMISSIONS).toContain('hr.costs.update');
    expect(ALL_PERMISSIONS).toContain('hr.costs_all.view');
    expect(ALL_PERMISSIONS).toContain('hr.costs_all.update');
  });

  test('projects.assignments is view+update only — view is the role-agnostic "all" marker', () => {
    // `view` lets a role load any project/activity assignment dialog regardless of membership
    // (issue #720); `update` permits editing. create/delete must not exist on this resource.
    expect(ALL_PERMISSIONS).toContain('projects.assignments.view');
    expect(ALL_PERMISSIONS).toContain('projects.assignments.update');
    expect(ALL_PERMISSIONS).not.toContain('projects.assignments.create');
    expect(ALL_PERMISSIONS).not.toContain('projects.assignments.delete');
  });

  test('timesheets.ril is view-only', () => {
    expect(ALL_PERMISSIONS).toContain('timesheets.ril.view');
    expect(ALL_PERMISSIONS).not.toContain('timesheets.ril.create');
    expect(ALL_PERMISSIONS).not.toContain('timesheets.ril.update');
    expect(ALL_PERMISSIONS).not.toContain('timesheets.ril.delete');
  });

  test('timesheets.expired_projects has only the create override action', () => {
    expect(ALL_PERMISSIONS).toContain('timesheets.expired_projects.create');
    expect(ALL_PERMISSIONS).not.toContain('timesheets.expired_projects.view');
    expect(ALL_PERMISSIONS).not.toContain('timesheets.expired_projects.update');
    expect(ALL_PERMISSIONS).not.toContain('timesheets.expired_projects.delete');
  });

  test('hr.costs is view+update only — no create/delete on either scope', () => {
    // The hr.costs resource is the personal-scope cost gate: view (read your own
    // cost, read-only counterpart of update) and update (edit your own cost) apply,
    // but create/delete must not exist on either the base or all-scope side.
    expect(ALL_PERMISSIONS).toContain('hr.costs.view');
    expect(ALL_PERMISSIONS).toContain('hr.costs.update');
    expect(ALL_PERMISSIONS).not.toContain('hr.costs.create');
    expect(ALL_PERMISSIONS).not.toContain('hr.costs.delete');
    expect(ALL_PERMISSIONS).not.toContain('hr.costs_all.create');
    expect(ALL_PERMISSIONS).not.toContain('hr.costs_all.delete');
    expect(ALL_PERMISSIONS).toContain('administration.roles.create');
    expect(ALL_PERMISSIONS).toContain('notifications.delete');
  });

  test('hr.internal is view+update only; create/delete are user-management permissions', () => {
    expect(ALL_PERMISSIONS).toContain('hr.internal.view');
    expect(ALL_PERMISSIONS).toContain('hr.internal.update');
    expect(ALL_PERMISSIONS).not.toContain('hr.internal.create');
    expect(ALL_PERMISSIONS).not.toContain('hr.internal.delete');
    expect(ALL_PERMISSIONS).toContain('administration.user_management.create');
    expect(ALL_PERMISSIONS).toContain('administration.user_management.delete');
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
    expect(isTopManagerOnlyPermission('hr.work_units_all.create')).toBe(true);
    expect(isTopManagerOnlyPermission('hr.work_units_all.delete')).toBe(true);
  });

  test('matches bare resource ids without an action suffix', () => {
    expect(isTopManagerOnlyPermission('hr.work_units')).toBe(true);
    expect(isTopManagerOnlyPermission('hr.work_units_all')).toBe(true);
  });

  test('does not match unrelated hr permissions', () => {
    expect(isTopManagerOnlyPermission('hr.internal.view')).toBe(false);
    expect(isTopManagerOnlyPermission('hr.costs.update')).toBe(false);
  });

  test('does not match look-alike resource names', () => {
    expect(isTopManagerOnlyPermission('hr.work_units_foo')).toBe(false);
    expect(isTopManagerOnlyPermission('hr.work_units_foo.view')).toBe(false);
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

describe('equivalentPermissionsFor / hasScopedActionPermission', () => {
  test('returns base and all-scope equivalents for scoped resources', () => {
    expect(equivalentPermissionsFor('crm.clients', 'update')).toEqual([
      'crm.clients.update',
      'crm.clients_all.update',
    ]);
  });

  test('returns only base permission for resources without all-scope variants', () => {
    expect(equivalentPermissionsFor('sales.client_quotes', 'delete')).toEqual([
      'sales.client_quotes.delete',
    ]);
  });

  test('accepts either base or all-scope action permissions', () => {
    expect(hasScopedActionPermission(['projects.tasks.update'], 'projects.tasks', 'update')).toBe(
      true,
    );
    expect(
      hasScopedActionPermission(['projects.tasks_all.update'], 'projects.tasks', 'update'),
    ).toBe(true);
  });
});

describe('hasAnyPermission', () => {
  test('normalizes legacy required permission aliases before checking', () => {
    expect(hasAnyPermission(['administration.general.view'], ['configuration.general.view'])).toBe(
      true,
    );
  });
});

describe('hasPermission', () => {
  test('returns true when the array contains the permission', () => {
    expect(hasPermission(['crm.clients.view', 'crm.clients.update'], 'crm.clients.view')).toBe(
      true,
    );
  });

  test('normalizes legacy permission aliases before checking', () => {
    expect(hasPermission(['administration.general.view'], 'configuration.general.view')).toBe(true);
    expect(hasPermission(['sales.supplier_quotes.create'], 'suppliers.quotes.create')).toBe(true);
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

describe('makeAccessChecker', () => {
  const ENTITY_ID = 'entity-1';
  const DEFAULT_SCOPE = 'crm.clients_all.view';

  test('short-circuits true when the request has the default *_all scope permission', async () => {
    const repoFn = mock(async () => false);
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    const request = { user: { id: 'u1', permissions: [DEFAULT_SCOPE] } };
    expect(await canAccess(request, ENTITY_ID)).toBe(true);
    expect(repoFn).not.toHaveBeenCalled();
  });

  test('short-circuits true when the request has a caller-supplied scope override', async () => {
    const repoFn = mock(async () => false);
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    const request = { user: { id: 'u1', permissions: ['crm.clients_all.delete'] } };
    // Caller asked us to gate on the *.delete variant rather than the default *.view.
    expect(await canAccess(request, ENTITY_ID, 'crm.clients_all.delete')).toBe(true);
    expect(repoFn).not.toHaveBeenCalled();
  });

  test('falls back to the repo lookup when the request lacks the *_all scope permission', async () => {
    const repoFn = mock(async () => true);
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    const request = { user: { id: 'u1', permissions: ['crm.clients.view'] } };
    expect(await canAccess(request, ENTITY_ID)).toBe(true);
    expect(repoFn).toHaveBeenCalledTimes(1);
    expect(repoFn).toHaveBeenCalledWith('u1', ENTITY_ID);
  });

  test('returns the repo verdict — false when the user is not assigned to the entity', async () => {
    const repoFn = mock(async () => false);
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    const request = { user: { id: 'u1', permissions: ['crm.clients.view'] } };
    expect(await canAccess(request, ENTITY_ID)).toBe(false);
    expect(repoFn).toHaveBeenCalledWith('u1', ENTITY_ID);
  });

  test('returns false without hitting the repo when the request has no user', async () => {
    const repoFn = mock(async () => true);
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    expect(await canAccess({}, ENTITY_ID)).toBe(false);
    expect(repoFn).not.toHaveBeenCalled();
  });

  test('returns false without hitting the repo when the user has no id', async () => {
    const repoFn = mock(async () => true);
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    const request = { user: { permissions: ['crm.clients.view'] } };
    expect(await canAccess(request, ENTITY_ID)).toBe(false);
    expect(repoFn).not.toHaveBeenCalled();
  });

  test('propagates repo errors to the caller', async () => {
    const repoFn = mock(async () => {
      throw new Error('repo boom');
    });
    const canAccess = makeAccessChecker(repoFn, DEFAULT_SCOPE);

    const request = { user: { id: 'u1', permissions: ['crm.clients.view'] } };
    await expect(canAccess(request, ENTITY_ID)).rejects.toThrow('repo boom');
  });
});

describe('requestHasPermission', () => {
  test('returns true when request.user.permissions contains the permission', () => {
    const request = { user: { permissions: ['crm.clients.view'] } };
    expect(requestHasPermission(request, 'crm.clients.view')).toBe(true);
  });

  test('normalizes legacy permission aliases before checking request permissions', () => {
    const request = { user: { permissions: ['administration.general.update'] } };
    expect(requestHasPermission(request, 'configuration.general.update')).toBe(true);
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
