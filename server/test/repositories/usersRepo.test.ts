import { beforeEach, describe, expect, test } from 'bun:test';
import * as usersRepo from '../../repositories/usersRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('getPasswordHash', () => {
  test('returns the hash when the row exists', async () => {
    exec.enqueue({ rows: [{ passwordHash: '$2b$10$abc' }] });
    const result = await usersRepo.getPasswordHash('user-1', exec);
    expect(result).toBe('$2b$10$abc');
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await usersRepo.getPasswordHash('user-1', exec);
    expect(result).toBeNull();
  });

  test('returns null when the row exists but passwordHash is null', async () => {
    exec.enqueue({ rows: [{ passwordHash: null }] });
    const result = await usersRepo.getPasswordHash('user-1', exec);
    expect(result).toBeNull();
  });
});

describe('findAuthUserById', () => {
  test('returns the mapped user when the row exists', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'manager',
          avatarInitials: 'AL',
          isDisabled: false,
        },
      ],
    });
    const result = await usersRepo.findAuthUserById('user-1', exec);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      isDisabled: false,
    });
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await usersRepo.findAuthUserById('user-1', exec);
    expect(result).toBeNull();
  });
});

describe('findLoginUserByUsername', () => {
  test('returns the mapped login user when the row exists', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'manager',
          passwordHash: '$2b$10$abc',
          avatarInitials: 'AL',
          isDisabled: false,
        },
      ],
    });
    const result = await usersRepo.findLoginUserByUsername('alice', exec);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      passwordHash: '$2b$10$abc',
      avatarInitials: 'AL',
      isDisabled: false,
    });
    expect(exec.calls[0].params).toEqual(['alice']);
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await usersRepo.findLoginUserByUsername('alice', exec);
    expect(result).toBeNull();
  });
});

describe('updatePasswordHash', () => {
  test('passes [hash, userId] in that order', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.updatePasswordHash('user-1', 'new-hash', exec);
    expect(exec.calls[0].params).toEqual(['new-hash', 'user-1']);
  });

  test('resolves to undefined', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    const result = await usersRepo.updatePasswordHash('user-1', 'new-hash', exec);
    expect(result).toBeUndefined();
  });
});
