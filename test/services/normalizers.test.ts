import { describe, expect, test } from 'bun:test';
import { normalizeUser } from '../../services/api/normalizers';
import type { User } from '../../types';

// `normalizeUser` exists to harden the boundary against payloads that arrive
// with missing/string/null fields. The tests intentionally hand it values that
// violate the static User type to assert runtime behavior.
type Loose<T> = { [K in keyof T]?: unknown } & Record<string, unknown>;
const make = <T>(base: T, overrides: Loose<T> = {}): T => ({ ...base, ...overrides }) as T;

const baseUser: User = {
  id: 'u-1',
  name: 'Alice',
  role: 'admin',
  avatarInitials: 'AL',
  username: 'alice',
};

describe('normalizeUser', () => {
  test('happy path: trims strings and parses costPerHour when present', () => {
    const input = make<User>(baseUser, {
      id: '  u-1  ',
      name: '  Alice  ',
      role: '  admin  ',
      avatarInitials: '  AL  ',
      username: '  alice  ',
      email: '  alice@x.com  ',
      costPerHour: '25.5',
      hasTopManagerRole: true,
      isAdminOnly: false,
      employeeType: 'internal',
      permissions: ['read', '  write  ', ''],
    });
    const result = normalizeUser(input);
    expect(result.id).toBe('u-1');
    expect(result.name).toBe('Alice');
    expect(result.role).toBe('admin');
    expect(result.avatarInitials).toBe('AL');
    expect(result.username).toBe('alice');
    expect(result.email).toBe('alice@x.com');
    expect(result.costPerHour).toBe(25.5);
    expect(result.hasTopManagerRole).toBe(true);
    expect(result.isAdminOnly).toBe(false);
    expect(result.employeeType).toBe('internal');
    expect(result.permissions).toEqual(['read', 'write']);
  });

  test('does NOT fabricate optional fields the API never sent', () => {
    // baseUser only carries the contract fields the server actually returns on
    // /auth/login and /auth/me (id, name, username, role, avatarInitials).
    // The normalizer must not invent defaults for unrelated fields - doing so
    // hides API contract drift and produces ghost values like costPerHour=0.
    const result = normalizeUser(baseUser);

    expect(result.email).toBeUndefined();
    expect(result.permissions).toEqual([]);
    expect(result.availableRoles).toBeUndefined();

    expect('costPerHour' in result).toBe(false);
    expect('hasTopManagerRole' in result).toBe(false);
    expect('isAdminOnly' in result).toBe(false);
    expect('employeeType' in result).toBe(false);
  });

  test('parses costPerHour=0 explicitly when the API sends a zero', () => {
    const input = make<User>(baseUser, { costPerHour: 0 });
    const result = normalizeUser(input);
    expect('costPerHour' in result).toBe(true);
    expect(result.costPerHour).toBe(0);
  });

  test('preserves explicit boolean false on hasTopManagerRole / isAdminOnly when sent', () => {
    const input = make<User>(baseUser, { hasTopManagerRole: false, isAdminOnly: false });
    const result = normalizeUser(input);
    expect('hasTopManagerRole' in result).toBe(true);
    expect('isAdminOnly' in result).toBe(true);
    expect(result.hasTopManagerRole).toBe(false);
    expect(result.isAdminOnly).toBe(false);
  });

  test('returns 0 for non-finite costPerHour input when present', () => {
    const input = make<User>(baseUser, { costPerHour: 'not-a-number' });
    expect(normalizeUser(input).costPerHour).toBe(0);
  });

  test('defaults employeeType to "app_user" for unknown values when present', () => {
    const input = make<User>(baseUser, { employeeType: 'unknown_type' });
    expect(normalizeUser(input).employeeType).toBe('app_user');
  });

  test('accepts "external" employeeType', () => {
    const input = make<User>(baseUser, { employeeType: 'external' });
    expect(normalizeUser(input).employeeType).toBe('external');
  });

  test('normalizes availableRoles: drops invalid entries and coerces booleans', () => {
    const input = make<User>(baseUser, {
      availableRoles: [
        { id: 'r1', name: 'Admin', isSystem: 1, isAdmin: true },
        { id: '', name: 'NoId' },
        { id: 'r3', name: '' },
        null,
        'string-entry',
        { id: '  r4  ', name: '  User  ' },
      ],
    });
    expect(normalizeUser(input).availableRoles).toEqual([
      { id: 'r1', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'r4', name: 'User', isSystem: false, isAdmin: false },
    ]);
  });

  test('returns empty array for non-array availableRoles', () => {
    const input = make<User>(baseUser, { availableRoles: 'not-an-array' });
    expect(normalizeUser(input).availableRoles).toEqual([]);
  });

  test('returns empty array for non-array permissions', () => {
    const input = make<User>(baseUser, { permissions: 'read' });
    expect(normalizeUser(input).permissions).toEqual([]);
  });

  test('coerces email empty/whitespace to undefined when present', () => {
    const input = make<User>(baseUser, { email: '   ' });
    const result = normalizeUser(input);
    expect(result.email).toBeUndefined();
  });
});
