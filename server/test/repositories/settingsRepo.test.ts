import { beforeEach, describe, expect, test } from 'bun:test';
import * as settingsRepo from '../../repositories/settingsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('getOrCreateForUser', () => {
  test('returns the existing row and skips the INSERT when one is found', async () => {
    const existing = { fullName: 'Alice', email: 'a@x', language: 'en' as const };
    exec.enqueue({ rows: [existing] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-1',
      { fullName: 'fallback', email: 'fb@x' },
      exec,
    );
    expect(result).toEqual(existing);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('inserts with the provided defaults when no row exists', async () => {
    const inserted = { fullName: 'Bob', email: 'b@x', language: 'auto' as const };
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [inserted] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-2',
      { fullName: 'Bob', email: 'b@x' },
      exec,
    );
    expect(result).toEqual(inserted);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[1].sql).toContain('INSERT INTO settings');
    expect(exec.calls[1].params).toEqual(['user-2', 'Bob', 'b@x']);
  });
});

describe('upsertForUser', () => {
  test('passes [userId, fullName, email, language, DEFAULT_LANGUAGE] as $1..$5', async () => {
    const row = { fullName: 'C', email: 'c@x', language: 'it' as const };
    exec.enqueue({ rows: [row] });
    await settingsRepo.upsertForUser(
      'user-3',
      { fullName: 'C', email: 'c@x', language: 'it' },
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      'user-3',
      'C',
      'c@x',
      'it',
      settingsRepo.DEFAULT_LANGUAGE,
    ]);
  });

  test('passes DEFAULT_LANGUAGE as the fallback param when language is null', async () => {
    const row = { fullName: null, email: null, language: 'auto' as const };
    exec.enqueue({ rows: [row] });
    await settingsRepo.upsertForUser(
      'user-4',
      { fullName: null, email: null, language: null },
      exec,
    );
    expect(exec.calls[0].params[3]).toBeNull();
    expect(exec.calls[0].params[4]).toBe(settingsRepo.DEFAULT_LANGUAGE);
  });

  test('returns the row from RETURNING', async () => {
    const row = { fullName: 'D', email: 'd@x', language: 'en' as const };
    exec.enqueue({ rows: [row] });
    const result = await settingsRepo.upsertForUser(
      'user-5',
      { fullName: 'D', email: 'd@x', language: 'en' },
      exec,
    );
    expect(result).toEqual(row);
  });
});
