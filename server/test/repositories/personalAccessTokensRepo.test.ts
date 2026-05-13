import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as personalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

const createdAt = new Date('2026-05-11T08:00:00.000Z');
const updatedAt = new Date('2026-05-11T09:00:00.000Z');
const lastUsedAt = new Date('2026-05-11T10:00:00.000Z');

const tokenRow = [
  'user-1',
  'a'.repeat(64),
  'praetor_pat_abc12345',
  createdAt,
  updatedAt,
  lastUsedAt,
];

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('findByUserId', () => {
  test('maps the token row for a user', async () => {
    exec.enqueue({ rows: [tokenRow] });

    const result = await personalAccessTokensRepo.findByUserId('user-1', testDb);

    expect(result).toEqual({
      userId: 'user-1',
      tokenHash: 'a'.repeat(64),
      tokenPrefix: 'praetor_pat_abc12345',
      createdAt,
      updatedAt,
      lastUsedAt,
    });
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('returns null when no token exists', async () => {
    exec.enqueue({ rows: [] });
    await expect(personalAccessTokensRepo.findByUserId('missing', testDb)).resolves.toBeNull();
  });
});

describe('findByTokenHash', () => {
  test('looks up by token hash', async () => {
    exec.enqueue({ rows: [tokenRow] });

    await personalAccessTokensRepo.findByTokenHash('a'.repeat(64), testDb);

    expect(exec.calls[0].sql.toLowerCase()).toContain('"token_hash"');
    expect(exec.calls[0].params).toContain('a'.repeat(64));
  });
});

describe('createForUserIfMissing', () => {
  test('inserts and reports created when no token exists', async () => {
    exec.enqueue({ rows: [] }); // initial SELECT: no existing row
    exec.enqueue({ rows: [tokenRow] }); // INSERT returns the new row

    const result = await personalAccessTokensRepo.createForUserIfMissing(
      'user-1',
      'a'.repeat(64),
      'praetor_pat_abc12345',
      testDb,
    );

    expect(result.created).toBe(true);
    expect(result.record.userId).toBe('user-1');
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('select');
    expect(exec.calls[1].sql.toLowerCase()).toContain('on conflict');
    expect(exec.calls[1].sql.toLowerCase()).toContain('do nothing');
  });

  test('returns existing record without inserting when one already exists', async () => {
    exec.enqueue({ rows: [tokenRow] }); // initial SELECT finds the existing row

    const result = await personalAccessTokensRepo.createForUserIfMissing(
      'user-1',
      'b'.repeat(64),
      'praetor_pat_newtoken',
      testDb,
    );

    expect(result.created).toBe(false);
    expect(result.record.tokenHash).toBe('a'.repeat(64));
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('select');
  });

  test('falls back to the winning row when a concurrent insert wins the race', async () => {
    exec.enqueue({ rows: [] }); // initial SELECT: no row yet
    exec.enqueue({ rows: [] }); // INSERT loses the ON CONFLICT race
    exec.enqueue({ rows: [tokenRow] }); // re-SELECT returns the winner's row

    const result = await personalAccessTokensRepo.createForUserIfMissing(
      'user-1',
      'b'.repeat(64),
      'praetor_pat_newtoken',
      testDb,
    );

    expect(result.created).toBe(false);
    expect(result.record.tokenHash).toBe('a'.repeat(64));
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[1].sql.toLowerCase()).toContain('on conflict');
  });
});

describe('renewForUser', () => {
  test('upserts the new hash and clears lastUsedAt', async () => {
    exec.enqueue({ rows: [[...tokenRow.slice(0, 5), null]] });

    const result = await personalAccessTokensRepo.renewForUser(
      'user-1',
      'b'.repeat(64),
      'praetor_pat_newtoken',
      testDb,
    );

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
    expect(exec.calls[0].params).toContain('b'.repeat(64));
    expect(result.lastUsedAt).toBeNull();
  });
});

describe('markUsed', () => {
  test('updates last_used_at for the hash', async () => {
    exec.enqueue({ rows: [] });

    await personalAccessTokensRepo.markUsed('a'.repeat(64), testDb);

    expect(exec.calls[0].sql.toLowerCase()).toContain('update "personal_access_tokens"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"last_used_at"');
    expect(exec.calls[0].params).toContain('a'.repeat(64));
  });
});
