import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as settingsRepo from '../../repositories/settingsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Rows are positional in SETTINGS_PROJECTION order: [fullName, email, language,
// rilWeekdayTransferDefaults].

describe('getOrCreateForUser', () => {
  test('returns the existing row and skips the INSERT when one is found', async () => {
    exec.enqueue({ rows: [['Alice', 'a@x', 'en', { monday: 'Telelavoro' }]] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-1',
      { fullName: 'fallback', email: 'fb@x' },
      testDb,
    );
    expect(result).toEqual({
      fullName: 'Alice',
      email: 'a@x',
      language: 'en',
      rilWeekdayTransferDefaults: { monday: 'Telelavoro' },
    });
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('inserts with the provided defaults when no row exists', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['Bob', 'b@x', 'auto', {}]] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-2',
      { fullName: 'Bob', email: 'b@x' },
      testDb,
    );
    expect(result).toEqual({
      fullName: 'Bob',
      email: 'b@x',
      language: 'auto',
      rilWeekdayTransferDefaults: {},
    });
    expect(exec.calls).toHaveLength(2);
    const insertSql = exec.calls[1].sql.toLowerCase();
    expect(insertSql).toContain('insert into "settings"');
    expect(insertSql).toContain('on conflict');
    expect(insertSql).toContain('do nothing');
    expect(exec.calls[1].params).toContain('user-2');
    expect(exec.calls[1].params).toContain('Bob');
    expect(exec.calls[1].params).toContain('b@x');
  });

  test('coerces null language from an existing row to DEFAULT_LANGUAGE', async () => {
    exec.enqueue({ rows: [['Eve', 'e@x', null, {}]] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-6',
      { fullName: 'Eve', email: 'e@x' },
      testDb,
    );
    expect(result.language).toBe(settingsRepo.DEFAULT_LANGUAGE);
  });

  test('coerces null weekday defaults from an existing row to an empty object', async () => {
    exec.enqueue({ rows: [['Eve', 'e@x', 'en', null]] });
    const result = await settingsRepo.getOrCreateForUser(
      'user-6b',
      { fullName: 'Eve', email: 'e@x' },
      testDb,
    );
    expect(result.rilWeekdayTransferDefaults).toEqual({});
  });

  test('falls back to the winning row when a concurrent insert wins the race', async () => {
    exec.enqueue({ rows: [] }); // initial SELECT: no row yet
    exec.enqueue({ rows: [] }); // INSERT ... ON CONFLICT DO NOTHING returns no row
    exec.enqueue({ rows: [['Winner', 'w@x', 'en', {}]] }); // re-SELECT returns the winner

    const result = await settingsRepo.getOrCreateForUser(
      'user-9',
      { fullName: 'Loser', email: 'l@x' },
      testDb,
    );

    expect(result).toEqual({
      fullName: 'Winner',
      email: 'w@x',
      language: 'en',
      rilWeekdayTransferDefaults: {},
    });
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[1].sql.toLowerCase()).toContain('on conflict');
    expect(exec.calls[2].sql.toLowerCase()).toContain('select');
  });

  test('throws if the re-SELECT after a lost race returns no row', async () => {
    exec.enqueue({ rows: [] }); // initial SELECT: no row yet
    exec.enqueue({ rows: [] }); // INSERT no-op via ON CONFLICT
    exec.enqueue({ rows: [] }); // re-SELECT also returns nothing

    await expect(
      settingsRepo.getOrCreateForUser('user-10', { fullName: null, email: null }, testDb),
    ).rejects.toThrow(/row missing after insert/);
  });
});

describe('upsertForUser', () => {
  test('passes userId, fullName, email, and language in the params', async () => {
    exec.enqueue({ rows: [['C', 'c@x', 'it', {}]] });
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
    exec.enqueue({ rows: [[null, null, 'auto', {}]] });
    await settingsRepo.upsertForUser(
      'user-4',
      { fullName: null, email: null, language: null },
      testDb,
    );
    expect(exec.calls[0].params).toContain(settingsRepo.DEFAULT_LANGUAGE);
  });

  test('returns the row from RETURNING', async () => {
    exec.enqueue({ rows: [['D', 'd@x', 'en', { friday: 'In sede' }]] });
    const result = await settingsRepo.upsertForUser(
      'user-5',
      { fullName: 'D', email: 'd@x', language: 'en' },
      testDb,
    );
    expect(result).toEqual({
      fullName: 'D',
      email: 'd@x',
      language: 'en',
      rilWeekdayTransferDefaults: { friday: 'In sede' },
    });
  });

  test('coerces null language from RETURNING to DEFAULT_LANGUAGE', async () => {
    exec.enqueue({ rows: [['F', 'f@x', null, {}]] });
    const result = await settingsRepo.upsertForUser(
      'user-7',
      { fullName: 'F', email: 'f@x', language: null },
      testDb,
    );
    expect(result.language).toBe(settingsRepo.DEFAULT_LANGUAGE);
  });

  test('emits ON CONFLICT DO UPDATE for the upsert', async () => {
    exec.enqueue({ rows: [['G', 'g@x', 'en', {}]] });
    await settingsRepo.upsertForUser(
      'user-8',
      { fullName: 'G', email: 'g@x', language: 'en' },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
  });

  test('binds a stringified jsonb param when weekday defaults are provided', async () => {
    exec.enqueue({ rows: [['H', 'h@x', 'en', { monday: 'Telelavoro' }]] });
    await settingsRepo.upsertForUser(
      'user-11',
      {
        fullName: 'H',
        email: 'h@x',
        language: 'en',
        rilWeekdayTransferDefaults: { monday: 'Telelavoro' },
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain(JSON.stringify({ monday: 'Telelavoro' }));
  });

  test('binds NULL for weekday defaults when omitted (COALESCE preserves the column)', async () => {
    exec.enqueue({ rows: [['I', 'i@x', 'en', { monday: 'Telelavoro' }]] });
    await settingsRepo.upsertForUser(
      'user-12',
      { fullName: 'I', email: 'i@x', language: 'en' },
      testDb,
    );
    // The INSERT value falls back to {}; the only stringified-object param would be the COALESCE
    // patch, which must be null here so the stored column is preserved on conflict.
    expect(exec.calls[0].params).not.toContain(JSON.stringify({ monday: 'Telelavoro' }));
  });
});
