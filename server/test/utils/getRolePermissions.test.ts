import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';

const rolesRepoSnap = { ...realRolesRepo };
const findByIdMock = mock();
const listExplicitPermissionsMock = mock();

let getRolePermissions: typeof import('../../utils/permissions.ts').getRolePermissions;
let ADMINISTRATION_PERMISSIONS: typeof import('../../utils/permissions.ts').ADMINISTRATION_PERMISSIONS;
let ADMIN_BASE_PERMISSIONS: typeof import('../../utils/permissions.ts').ADMIN_BASE_PERMISSIONS;
let ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS: typeof import('../../utils/permissions.ts').ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS;

beforeAll(async () => {
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    findById: findByIdMock,
    listExplicitPermissions: listExplicitPermissionsMock,
  }));

  const mod = await import('../../utils/permissions.ts');
  getRolePermissions = mod.getRolePermissions;
  ADMINISTRATION_PERMISSIONS = mod.ADMINISTRATION_PERMISSIONS;
  ADMIN_BASE_PERMISSIONS = mod.ADMIN_BASE_PERMISSIONS;
  ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS = mod.ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS;
});

afterAll(() => {
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
});

describe('getRolePermissions', () => {
  test('returns [] when the role does not exist', async () => {
    findByIdMock.mockResolvedValueOnce(null);
    listExplicitPermissionsMock.mockResolvedValueOnce([]);

    expect(await getRolePermissions('missing')).toEqual([]);
  });

  test('admin role union covers administration + base + always-granted + explicit, deduped', async () => {
    findByIdMock.mockResolvedValueOnce({
      id: 'admin',
      name: 'Admin',
      isSystem: true,
      isAdmin: true,
    });
    // Include an extra explicit perm plus a duplicate of an always-granted one to verify dedup.
    listExplicitPermissionsMock.mockResolvedValueOnce([
      'crm.clients.view',
      'hr.internal.view',
      'notifications.view',
    ]);

    const perms = await getRolePermissions('admin');

    for (const p of ADMINISTRATION_PERMISSIONS) expect(perms).toContain(p);
    for (const p of ADMIN_BASE_PERMISSIONS) expect(perms).toContain(p);
    for (const p of ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS) expect(perms).toContain(p);
    expect(perms).toContain('crm.clients.view');
    expect(perms.some((permission) => permission.startsWith('hr.'))).toBe(false);
    expect(new Set(perms).size).toBe(perms.length);
  });

  test('non-admin role returns explicit permissions + always-granted notifications, deduped', async () => {
    findByIdMock.mockResolvedValueOnce({
      id: 'manager',
      name: 'Manager',
      isSystem: true,
      isAdmin: false,
    });
    listExplicitPermissionsMock.mockResolvedValueOnce([
      'crm.clients.view',
      'notifications.view', // duplicate of always-granted
    ]);

    const perms = await getRolePermissions('manager');

    expect(perms).toContain('crm.clients.view');
    for (const p of ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS) expect(perms).toContain(p);
    for (const p of ADMINISTRATION_PERMISSIONS) expect(perms).not.toContain(p);
    expect(new Set(perms).size).toBe(perms.length);
  });

  test('normalizes legacy permission prefixes from the DB before merging', async () => {
    findByIdMock.mockResolvedValueOnce({
      id: 'legacy',
      name: 'Legacy',
      isSystem: false,
      isAdmin: false,
    });
    listExplicitPermissionsMock.mockResolvedValueOnce([
      'configuration.general.view',
      'suppliers.quotes.create',
    ]);

    const perms = await getRolePermissions('legacy');

    expect(perms).toContain('administration.general.view');
    expect(perms).toContain('sales.supplier_quotes.create');
    expect(perms).not.toContain('configuration.general.view');
    expect(perms).not.toContain('suppliers.quotes.create');
  });
});
