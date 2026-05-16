import { describe, expect, test } from 'bun:test';
import type {
  LdapConfig as BackendLdapConfig,
  LdapRoleMapping as BackendLdapRoleMapping,
} from '../server/types/ldap.ts';
import type {
  LdapConfig as FrontendLdapConfig,
  LdapRoleMapping as FrontendLdapRoleMapping,
  KnownPermission,
  KnownUserRole,
  Permission,
  UserRole,
} from '../types';

// Compile-time assertion helpers. These checks run during `tsc --noEmit`: any failure
// here surfaces as a TypeScript error, which prevents `bun run lint` / typecheck from
// succeeding. The runtime `expect(true).toBe(true)` keeps Bun's test reporter happy.
type AssertExtends<T, U> = T extends U ? true : false;
type AssertEqual<T, U> =
  (<V>() => V extends T ? 1 : 2) extends <V>() => V extends U ? 1 : 2
    ? (<V>() => V extends U ? 1 : 2) extends <V>() => V extends T ? 1 : 2
      ? true
      : false
    : false;

const trueValue: true = true;

// Each test in this file is a pure type-level check: the typed variable assignments
// below either compile or trigger a `@ts-expect-error`, and `tsc --noEmit` is what
// makes the test "fail" by breaking the build. The runtime `expect(true).toBe(true)`
// is just a placeholder so Bun's reporter shows the spec as executed — comparing the
// typed literals to themselves would pass vacuously regardless of the type definitions.
describe('UserRole literal union', () => {
  test('accepts the four built-in role ids', () => {
    const admin: UserRole = 'admin';
    const manager: UserRole = 'manager';
    const user: UserRole = 'user';
    const topManager: UserRole = 'top_manager';
    void [admin, manager, user, topManager];
    expect(true).toBe(true);
  });

  test('KnownUserRole rejects typos like "amdin"', () => {
    // @ts-expect-error - 'amdin' is not a built-in role id
    const typo: KnownUserRole = 'amdin';
    // The valid spelling compiles without error.
    const valid: KnownUserRole = 'admin';
    void [typo, valid];
    expect(true).toBe(true);
  });

  test('UserRole still accepts arbitrary strings (custom DB-defined roles)', () => {
    // The `string & {}` escape hatch keeps `UserRole` assignable from any string so
    // custom role ids stored in the `roles` table continue to work.
    const custom: UserRole = 'custom_role_from_db';
    void custom;
    const knownExtendsUserRole: AssertExtends<KnownUserRole, UserRole> = trueValue;
    // trueValue's type is the literal `true`; this assertion verifies the compile-time
    // relationship (KnownUserRole extends UserRole) rather than the runtime value, which
    // is trivially true by construction.
    expect(knownExtendsUserRole).toBe(true);
  });
});

describe('Permission literal union', () => {
  test('accepts well-formed known permissions', () => {
    const view: Permission = 'crm.clients.view';
    const update: Permission = 'administration.roles.update';
    void [view, update];
    expect(true).toBe(true);
  });

  test('KnownPermission rejects typos in the resource/action segments', () => {
    // @ts-expect-error - 'crm.clinets.view' has a misspelled resource
    const typo: KnownPermission = 'crm.clinets.view';
    // @ts-expect-error - 'view2' is not a known action
    const badAction: KnownPermission = 'crm.clients.view2';
    const valid: KnownPermission = 'crm.clients.view';
    void [typo, badAction, valid];
    expect(true).toBe(true);
  });

  test('Permission still accepts arbitrary strings (DB-driven extensibility)', () => {
    const custom: Permission = 'custom.module.view';
    void custom;
    const knownExtendsPermission: AssertEqual<
      Permission extends string ? true : false,
      true
    > = trueValue;
    // Compile-time assertion of a type relationship; runtime value is trivially true.
    expect(knownExtendsPermission).toBe(true);
  });
});

describe('LDAP config contract', () => {
  test('frontend and backend role mapping shapes stay aligned', () => {
    const sameRoleMappingShape: AssertEqual<BackendLdapRoleMapping, FrontendLdapRoleMapping> =
      trueValue;
    expect(sameRoleMappingShape).toBe(true);
  });

  test('frontend and backend config shapes stay aligned', () => {
    type BackendOnlyKey = Exclude<keyof BackendLdapConfig, keyof FrontendLdapConfig>;
    type FrontendOnlyKey = Exclude<keyof FrontendLdapConfig, keyof BackendLdapConfig>;

    const noBackendOnlyKeys: AssertEqual<BackendOnlyKey, never> = trueValue;
    const noFrontendOnlyKeys: AssertEqual<FrontendOnlyKey, never> = trueValue;
    const sameConfigShape: AssertEqual<BackendLdapConfig, FrontendLdapConfig> = trueValue;

    expect(noBackendOnlyKeys).toBe(true);
    expect(noFrontendOnlyKeys).toBe(true);
    expect(sameConfigShape).toBe(true);
  });
});
