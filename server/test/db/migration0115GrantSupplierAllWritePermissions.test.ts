import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0115_grant_supplier_all_write_permissions.sql');

const permissionMappings = Array.from(
  MIGRATION.matchAll(/\('([^']+)',\s*'([^']+)'\)/g),
  (match) => ({ base: match[1], all: match[2] }),
);

const upgradeLegacyPermissions = (legacy: Record<string, string[]>) => {
  const upgraded = new Map(
    Object.entries(legacy).map(([roleId, permissions]) => [roleId, new Set(permissions)]),
  );
  for (const permissions of upgraded.values()) {
    if (!permissions.has('crm.suppliers_all.view')) continue;
    for (const mapping of permissionMappings) {
      if (permissions.has(mapping.base)) permissions.add(mapping.all);
    }
  }
  return upgraded;
};

describe('migration 0115: promotes trusted legacy supplier write grants', () => {
  test('maps only supplier update and delete to their all-scope actions', () => {
    expect(permissionMappings).toEqual([
      { base: 'crm.suppliers.update', all: 'crm.suppliers_all.update' },
      { base: 'crm.suppliers.delete', all: 'crm.suppliers_all.delete' },
    ]);
  });

  test('requires the same role to hold full supplier visibility before promotion', () => {
    expect(MIGRATION).toMatch(/full_scope\.role_id\s*=\s*base\.role_id/i);
    expect(MIGRATION).toMatch(/full_scope\.permission\s*=\s*'crm\.suppliers_all\.view'/i);
  });

  test('upgrades legacy global writers without widening limited roles', () => {
    const upgraded = upgradeLegacyPermissions({
      manager: ['crm.suppliers_all.view', 'crm.suppliers.update', 'crm.suppliers.delete'],
      limited_editor: ['crm.suppliers.update', 'crm.suppliers.delete'],
      full_viewer: ['crm.suppliers_all.view'],
    });

    expect(upgraded.get('manager')).toEqual(
      new Set([
        'crm.suppliers_all.view',
        'crm.suppliers.update',
        'crm.suppliers.delete',
        'crm.suppliers_all.update',
        'crm.suppliers_all.delete',
      ]),
    );
    expect(upgraded.get('limited_editor')).toEqual(
      new Set(['crm.suppliers.update', 'crm.suppliers.delete']),
    );
    expect(upgraded.get('full_viewer')).toEqual(new Set(['crm.suppliers_all.view']));
  });

  test('is retry-safe', () => {
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
    const once = upgradeLegacyPermissions({
      custom: ['crm.suppliers_all.view', 'crm.suppliers.update'],
    });
    const twice = upgradeLegacyPermissions({ custom: [...(once.get('custom') ?? [])] });
    expect(twice).toEqual(once);
  });
});
