import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as settingsRepo from '../../repositories/settingsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('getOrCreateForUser', () => {
  test('returns the existing row and skips the INSERT when one is found', async () => {
    exec.enqueue({ rows: [['Alice', 'a@x', 'en']] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-1',
      { fullName: 'fallback', email: 'fb@x' },
      testDb,
    );
    expect(result).toEqual({ fullName: 'Alice', email: 'a@x', language: 'en' });
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('inserts with the provided defaults when no row exists', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['Bob', 'b@x', 'auto']] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-2',
      { fullName: 'Bob', email: 'b@x' },
      testDb,
    );
    expect(result).toEqual({ fullName: 'Bob', email: 'b@x', language: 'auto' });
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[1].sql.toLowerCase()).toContain('insert into "settings"');
    expect(exec.calls[1].params).toContain('user-2');
    expect(exec.calls[1].params).toContain('Bob');
    expect(exec.calls[1].params).toContain('b@x');
  });

  test('coerces null language from an existing row to DEFAULT_LANGUAGE', async () => {
    exec.enqueue({ rows: [['Eve', 'e@x', null]] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-6',
      { fullName: 'Eve', email: 'e@x' },
      testDb,
    );
    expect(result.language).toBe(settingsRepo.DEFAULT_LANGUAGE);
  });
});

describe('upsertForUser', () => {
  test('passes userId, fullName, email, and language in the params', async () => {
    exec.enqueue({ rows: [['C', 'c@x', 'it']] });
    await settingsRepo.upsertForUser(
      'user-3',
      { fullName: 'C', email: 'c@x', language: 'it' },
      testDb,
    );
    expect(exec.calls[0].params).toContain('user-3');
    expect(exec.calls[0].params).toContain('C');
    expect(exec.calls[0].params).toContain('c@x');
    expect(exec.calls[0].params).toContain('it');
  });

  test('falls back to DEFAULT_LANGUAGE on insert when language is null', async () => {
    exec.enqueue({ rows: [[null, null, 'auto']] });
    await settingsRepo.upsertForUser(
      'user-4',
      { fullName: null, email: null, language: null },
      testDb,
    );
    expect(exec.calls[0].params).toContain(settingsRepo.DEFAULT_LANGUAGE);
  });

  test('returns the row from RETURNING', async () => {
    exec.enqueue({ rows: [['D', 'd@x', 'en']] });
    const result = await settingsRepo.upsertForUser(
      'user-5',
      { fullName: 'D', email: 'd@x', language: 'en' },
      testDb,
    );
    expect(result).toEqual({ fullName: 'D', email: 'd@x', language: 'en' });
  });

  test('coerces null language from RETURNING to DEFAULT_LANGUAGE', async () => {
    exec.enqueue({ rows: [['F', 'f@x', null]] });
    const result = await settingsRepo.upsertForUser(
      'user-7',
      { fullName: 'F', email: 'f@x', language: null },
      testDb,
    );
    expect(result.language).toBe(settingsRepo.DEFAULT_LANGUAGE);
  });

  test('emits ON CONFLICT DO UPDATE for the upsert', async () => {
    exec.enqueue({ rows: [['G', 'g@x', 'en']] });
    await settingsRepo.upsertForUser(
      'user-8',
      { fullName: 'G', email: 'g@x', language: 'en' },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
  });
});
