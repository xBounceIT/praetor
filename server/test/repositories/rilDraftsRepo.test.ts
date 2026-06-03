import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as rilDraftsRepo from '../../repositories/rilDraftsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Rows are positional in RIL_DRAFT_PROJECTION order: [monthKey, rows, updatedAt].

describe('getForUserMonth', () => {
  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await rilDraftsRepo.getForUserMonth('user-1', '2026-06', testDb);
    expect(result).toBeNull();
  });

  test('maps a row and passes the rows object through', async () => {
    const rows = { '3': { entrance: '09:00', exit: '17:00', notes: '', transfer: '', code: '' } };
    exec.enqueue({ rows: [['2026-06', rows, new Date('2026-06-01T00:00:00.000Z')]] });
    const result = await rilDraftsRepo.getForUserMonth('user-2', '2026-06', testDb);
    expect(result).toEqual({
      monthKey: '2026-06',
      rows,
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
  });

  test('coerces null rows to an empty object', async () => {
    exec.enqueue({ rows: [['2026-06', null, new Date('2026-06-01T00:00:00.000Z')]] });
    const result = await rilDraftsRepo.getForUserMonth('user-3', '2026-06', testDb);
    expect(result?.rows).toEqual({});
  });

  test('converts a Date updatedAt to an ISO string', async () => {
    const when = new Date('2026-06-02T08:30:00.000Z');
    exec.enqueue({ rows: [['2026-06', {}, when]] });
    const result = await rilDraftsRepo.getForUserMonth('user-4', '2026-06', testDb);
    expect(result?.updatedAt).toBe('2026-06-02T08:30:00.000Z');
  });

  test('maps a null updatedAt to null', async () => {
    exec.enqueue({ rows: [['2026-06', {}, null]] });
    const result = await rilDraftsRepo.getForUserMonth('user-5', '2026-06', testDb);
    expect(result?.updatedAt).toBeNull();
  });

  test('binds userId and monthKey in the WHERE clause', async () => {
    exec.enqueue({ rows: [] });
    await rilDraftsRepo.getForUserMonth('user-6', '2026-07', testDb);
    expect(exec.calls).toHaveLength(1);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('select');
    expect(sql).toContain('where');
    expect(exec.calls[0].params).toContain('user-6');
    expect(exec.calls[0].params).toContain('2026-07');
  });
});

describe('upsertForUserMonth', () => {
  test('emits ON CONFLICT DO UPDATE', async () => {
    exec.enqueue({ rows: [['2026-06', {}, new Date('2026-06-01T00:00:00.000Z')]] });
    await rilDraftsRepo.upsertForUserMonth('user-7', '2026-06', {}, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('insert into "ril_drafts"');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
  });

  test('binds userId, monthKey, and the rows object', async () => {
    const rows = {
      '5': { entrance: '08:00', exit: '16:00', notes: 'n', transfer: 't', code: 'c' },
    };
    exec.enqueue({ rows: [['2026-08', rows, new Date('2026-08-01T00:00:00.000Z')]] });
    await rilDraftsRepo.upsertForUserMonth('user-8', '2026-08', rows, testDb);
    expect(exec.calls[0].params).toContain('user-8');
    expect(exec.calls[0].params).toContain('2026-08');
    expect(exec.calls[0].params).toContain(JSON.stringify(rows));
  });

  test('returns the mapped RETURNING row', async () => {
    const rows = { '9': { entrance: '09:30', exit: '18:00', notes: '', transfer: '', code: '' } };
    exec.enqueue({ rows: [['2026-09', rows, new Date('2026-09-15T12:00:00.000Z')]] });
    const result = await rilDraftsRepo.upsertForUserMonth('user-9', '2026-09', rows, testDb);
    expect(result).toEqual({
      monthKey: '2026-09',
      rows,
      updatedAt: '2026-09-15T12:00:00.000Z',
    });
  });
});

describe('deleteForUserMonth', () => {
  test('returns true when RETURNING yields a row', async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await rilDraftsRepo.deleteForUserMonth('user-10', '2026-06', testDb);
    expect(result).toBe(true);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('delete from "ril_drafts"');
    expect(exec.calls[0].params).toContain('user-10');
    expect(exec.calls[0].params).toContain('2026-06');
  });

  test('returns false when RETURNING is empty', async () => {
    exec.enqueue({ rows: [] });
    const result = await rilDraftsRepo.deleteForUserMonth('user-11', '2026-06', testDb);
    expect(result).toBe(false);
  });
});
