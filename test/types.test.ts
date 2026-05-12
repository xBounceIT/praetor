import { describe, expect, test } from 'bun:test';
import type { KnownPermission, KnownUserRole, Permission, UserRole } from '../types';

// Compile-time assertion helpers. These checks run during `tsc --noEmit`: any failure
// here surfaces as a TypeScript error, which prevents `bun run lint` / typecheck from
// succeeding. The runtime `expect(true).toBe(true)` keeps Bun's test reporter happy.
type AssertExtends<T, U> = T extends U ? true : false;
type AssertEqual<T, U> =
  AssertExtends<T, U> extends true ? (AssertExtends<U, T> extends true ? true : false) : false;

const trueValue: true = true;

describe('UserRole literal union', () => {
  test('accepts the four built-in role ids', () => {
    const admin: UserRole = 'admin';
    const manager: UserRole = 'manager';
    const user: UserRole = 'user';
    const topManager: UserRole = 'top_manager';
    expect([admin, manager, user, topManager]).toEqual(['admin', 'manager', 'user', 'top_manager']);
  });

  test('KnownUserRole rejects typos like "amdin"', () => {
    // @ts-expect-error - 'amdin' is not a built-in role id
    const typo: KnownUserRole = 'amdin';
    void typo;
    // The valid spelling compiles without error.
    const valid: KnownUserRole = 'admin';
    expect(valid).toBe('admin');
  });

  test('UserRole still accepts arbitrary strings (custom DB-defined roles)', () => {
    // The `string & {}` escape hatch keeps `UserRole` assignable from any string so
    // custom role ids stored in the `roles` table continue to work.
    const custom: UserRole = 'custom_role_from_db';
    expect(custom).toBe('custom_role_from_db');
    const knownExtendsUserRole: AssertExtends<KnownUserRole, UserRole> = trueValue;
    expect(knownExtendsUserRole).toBe(true);
  });
});

describe('Permission literal union', () => {
  test('accepts well-formed known permissions', () => {
    const view: Permission = 'crm.clients.view';
    const update: Permission = 'administration.roles.update';
    expect([view, update]).toEqual(['crm.clients.view', 'administration.roles.update']);
  });

  test('KnownPermission rejects typos in the resource/action segments', () => {
    // @ts-expect-error - 'crm.clinets.view' has a misspelled resource
    const typo: KnownPermission = 'crm.clinets.view';
    void typo;
    // @ts-expect-error - 'view2' is not a known action
    const badAction: KnownPermission = 'crm.clients.view2';
    void badAction;
    const valid: KnownPermission = 'crm.clients.view';
    expect(valid).toBe('crm.clients.view');
  });

  test('Permission still accepts arbitrary strings (DB-driven extensibility)', () => {
    const custom: Permission = 'custom.module.view';
    expect(custom).toBe('custom.module.view');
    const knownExtendsPermission: AssertEqual<
      Permission extends string ? true : false,
      true
    > = trueValue;
    expect(knownExtendsPermission).toBe(true);
  });
});
