import { beforeEach, describe, expect, test } from 'bun:test';
import * as rolesRepo from '../../repositories/rolesRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('findExistingIds', () => {
  test('returns an empty Set without firing SQL when ids is empty', async () => {
    const result = await rolesRepo.findExistingIds([], exec);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes the ids array as a single $1 param (ANY($1::text[]) contract)', async () => {
    exec.enqueue({ rows: [{ id: 'a' }, { id: 'b' }] });
    await rolesRepo.findExistingIds(['a', 'b'], exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toEqual([['a', 'b']]);
  });

  test('returns a Set of the ids the DB confirmed', async () => {
    exec.enqueue({ rows: [{ id: 'a' }, { id: 'b' }] });
    const result = await rolesRepo.findExistingIds(['a', 'b'], exec);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  test('returns only the ids the DB confirmed, not the inputs', async () => {
    exec.enqueue({ rows: [{ id: 'a' }] });
    const result = await rolesRepo.findExistingIds(['a', 'b', 'c'], exec);
    expect(result.size).toBe(1);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
    expect(result.has('c')).toBe(false);
  });
});

describe('userHasRole', () => {
  test('returns true when the DB returns a row', async () => {
    exec.enqueue({ rows: [{}] });
    const result = await rolesRepo.userHasRole('user-1', 'manager', exec);
    expect(result).toBe(true);
    expect(exec.calls[0].params).toEqual(['user-1', 'manager']);
  });

  test('returns false when no row is returned', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.userHasRole('user-1', 'manager', exec);
    expect(result).toBe(false);
  });
});

describe('listAvailableRolesForUser', () => {
  test('returns the rows as-is and passes [userId]', async () => {
    exec.enqueue({
      rows: [
        { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
        { id: 'manager', name: 'Manager', isSystem: false, isAdmin: false },
      ],
    });
    const result = await rolesRepo.listAvailableRolesForUser('user-1', exec);
    expect(result).toEqual([
      { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'manager', name: 'Manager', isSystem: false, isAdmin: false },
    ]);
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns an empty array when the user has no roles', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.listAvailableRolesForUser('user-1', exec);
    expect(result).toEqual([]);
  });
});
