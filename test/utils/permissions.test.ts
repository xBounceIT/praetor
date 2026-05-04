import { describe, expect, test } from 'bun:test';
import {
  ALL_PERMISSIONS,
  ALWAYS_GRANTED_MODULES,
  buildPermission,
  buildPermissions,
  CONFIGURATION_PERMISSIONS,
  formatPermissionLabel,
  hasAnyPermission,
  hasPermission,
  isTopManagerOnlyPermission,
  PERMISSION_DEFINITIONS,
  ROLE_EDITOR_EXCLUDED_MODULES,
  VIEW_PERMISSION_MAP,
} from '../../utils/permissions';

describe('buildPermission / buildPermissions', () => {
  test('builds a "<resource>.<action>" permission string', () => {
    expect(buildPermission('crm.clients', 'view')).toBe('crm.clients.view');
  });

  test('builds permissions for every action in order', () => {
    expect(buildPermissions('crm.clients', ['view', 'create'])).toEqual([
      'crm.clients.view',
      'crm.clients.create',
    ]);
  });
});

describe('PERMISSION_DEFINITIONS / ALL_PERMISSIONS', () => {
  test('every definition expands into one permission per declared action', () => {
    const expected = PERMISSION_DEFINITIONS.reduce((sum, def) => sum + def.actions.length, 0);
    expect(ALL_PERMISSIONS.length).toBe(expected);
  });

  test('every definition has a module set', () => {
    PERMISSION_DEFINITIONS.forEach((def) => {
      expect(typeof def.module).toBe('string');
      expect(def.module.length).toBeGreaterThan(0);
    });
  });

  test('contains expected representative permissions', () => {
    expect(ALL_PERMISSIONS).toContain('crm.clients.view');
    expect(ALL_PERMISSIONS).toContain('hr.work_units.delete');
    expect(ALL_PERMISSIONS).toContain('administration.roles.update');
  });
});

describe('CONFIGURATION_PERMISSIONS', () => {
  test('contains only administration.* permissions', () => {
    expect(CONFIGURATION_PERMISSIONS.every((p) => p.startsWith('administration.'))).toBe(true);
    expect(CONFIGURATION_PERMISSIONS.length).toBeGreaterThan(0);
  });
});

describe('ALWAYS_GRANTED_MODULES / ROLE_EDITOR_EXCLUDED_MODULES', () => {
  test('always-granted modules include docs, settings, notifications', () => {
    expect(ALWAYS_GRANTED_MODULES).toContain('docs');
    expect(ALWAYS_GRANTED_MODULES).toContain('settings');
    expect(ALWAYS_GRANTED_MODULES).toContain('notifications');
  });

  test('role-editor exclusions include the always-granted set plus administration', () => {
    expect(ROLE_EDITOR_EXCLUDED_MODULES).toContain('administration');
    for (const m of ALWAYS_GRANTED_MODULES) expect(ROLE_EDITOR_EXCLUDED_MODULES).toContain(m);
  });
});

describe('isTopManagerOnlyPermission', () => {
  test('matches hr.work_units.* permissions', () => {
    expect(isTopManagerOnlyPermission('hr.work_units.view')).toBe(true);
    expect(isTopManagerOnlyPermission('hr.work_units.create')).toBe(true);
  });

  test('matches hr.work_units_all.* scope permissions', () => {
    expect(isTopManagerOnlyPermission('hr.work_units_all.view')).toBe(true);
  });

  test('does not match unrelated permissions', () => {
    expect(isTopManagerOnlyPermission('hr.internal.view')).toBe(false);
    expect(isTopManagerOnlyPermission('crm.clients.view')).toBe(false);
  });
});

describe('formatPermissionLabel', () => {
  test('uppercases the first letter of a single-word resource', () => {
    expect(formatPermissionLabel('settings')).toBe('Settings');
  });

  test('drops the module prefix and title-cases the remaining segment', () => {
    expect(formatPermissionLabel('crm.clients')).toBe('Clients');
  });

  test('replaces underscores with spaces and title-cases each word', () => {
    expect(formatPermissionLabel('administration.user_management')).toBe('User Management');
  });

  test('formats _all scope suffix as " (All)"', () => {
    expect(formatPermissionLabel('crm.clients_all')).toBe('Clients (All)');
    expect(formatPermissionLabel('hr.work_units_all')).toBe('Work Units (All)');
  });

  test('renders the literal string "API" instead of "Api" (acronym fix)', () => {
    expect(formatPermissionLabel('docs.api')).toBe('API');
  });
});

describe('hasPermission', () => {
  test('returns true when the array contains the permission', () => {
    expect(hasPermission(['crm.clients.view'], 'crm.clients.view')).toBe(true);
  });

  test('returns false when the permission is missing', () => {
    expect(hasPermission(['crm.clients.update'], 'crm.clients.view')).toBe(false);
  });

  test('returns false for undefined permissions', () => {
    expect(hasPermission(undefined, 'crm.clients.view')).toBe(false);
  });

  test('returns false for empty array', () => {
    expect(hasPermission([], 'crm.clients.view')).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  test('returns true when at least one required permission is present', () => {
    expect(hasAnyPermission(['crm.clients.view'], ['crm.clients.view', 'hr.internal.view'])).toBe(
      true,
    );
  });

  test('returns false when no required permission is present', () => {
    expect(hasAnyPermission(['crm.clients.update'], ['crm.clients.view', 'hr.internal.view'])).toBe(
      false,
    );
  });

  test('returns false for undefined permissions', () => {
    expect(hasAnyPermission(undefined, ['crm.clients.view'])).toBe(false);
  });

  test('returns false when required is empty', () => {
    expect(hasAnyPermission(['crm.clients.view'], [])).toBe(false);
  });
});

describe('VIEW_PERMISSION_MAP', () => {
  test('every mapped permission is a known permission in ALL_PERMISSIONS', () => {
    for (const [view, perm] of Object.entries(VIEW_PERMISSION_MAP)) {
      expect(ALL_PERMISSIONS).toContain(perm);
      expect(typeof view).toBe('string');
    }
  });

  test('all mapped permissions are .view actions', () => {
    for (const perm of Object.values(VIEW_PERMISSION_MAP)) {
      expect(perm.endsWith('.view')).toBe(true);
    }
  });
});
