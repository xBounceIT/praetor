import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as entriesRepo from '../../repositories/entriesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder fixtures match the column order in db/schema/timeEntries.ts. Raw-SQL fixtures
// are objects keyed by SELECT column name (snake_case + an extra `created_at_text` for
// cursor pagination — see ENTRY_COLUMNS_SQL).
const ENTRY_BASE: readonly unknown[] = [
  'e-1',
  'u-1',
  '2026-04-30',
  'c-1',
  'Acme',
  'p-1',
  'Alpha',
  'Dev',
  't-1',
  'n',
  '1.5',
  '100',
  false,
  'remote',
  new Date('2026-04-30T12:00:00Z'),
];

const entryRow = (overrides: Record<number, unknown> = {}) => makeRow(ENTRY_BASE, overrides);

const rawRow = {
  id: 'e-1',
  user_id: 'u-1',
  date: '2026-04-30',
  client_id: 'c-1',
  client_name: 'Acme',
  project_id: 'p-1',
  project_name: 'Alpha',
  task: 'Dev',
  task_id: 't-1',
  notes: 'n',
  duration: '1.5',
  hourly_cost: '100',
  is_placeholder: false,
  location: 'remote',
  created_at: new Date('2026-04-30T12:00:00Z'),
  created_at_text: '2026-04-30 12:00:00.000000',
};

describe('listAll', () => {
  test('passes default limit and no cursor', async () => {
    exec.enqueue({ rows: [] });
    const result = await entriesRepo.listAll({}, testDb);
    expect(exec.calls[0].params).toEqual([200]);
    expect(exec.calls[0].sql).not.toContain('WHERE');
    expect(result.nextCursor).toBeNull();
  });

  test('caps limit at 500', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll({ limit: 9999 }, testDb);
    expect(exec.calls[0].params).toEqual([500]);
  });

  test('cursor adds (created_at, id) < tuple comparison with µs-precision timestamp', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll(
      { limit: 50, cursor: { createdAt: '2026-04-30 12:00:00.123456', id: 'e-1' } },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['2026-04-30 12:00:00.123456', 'e-1', 50]);
    expect(exec.calls[0].sql).toContain('::timestamp');
    expect(exec.calls[0].sql).toContain('created_at_text');
    expect(exec.calls[0].sql).not.toContain('to_timestamp');
  });

  test.each([
    ['zero', 0, 200],
    ['negative', -5, 200],
    ['NaN', Number.NaN, 200],
    ['Infinity', Number.POSITIVE_INFINITY, 200],
    ['fractional truncates via Math.floor', 1.7, 1],
  ])('resolveLimit treats %s (%p) as %p', async (_label, input, expected) => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll({ limit: input }, testDb);
    expect(exec.calls[0].params).toEqual([expected]);
  });
});

describe('listForUser', () => {
  test('passes userId as $1 and limit at the end', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForUser('u-1', {}, testDb);
    expect(exec.calls[0].params).toEqual(['u-1', 200]);
    expect(exec.calls[0].sql).toContain('user_id = $1');
  });

  test('with cursor: cursor params follow userId, limit lands last', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForUser(
      'u-1',
      { limit: 50, cursor: { createdAt: '2026-04-30 12:00:00.123456', id: 'e-9' } },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['u-1', '2026-04-30 12:00:00.123456', 'e-9', 50]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('$2::timestamp');
    expect(sql).toContain('LIMIT $4');
  });
});

describe('listForManagerView', () => {
  test('uses managerId for both own + managed subquery (Drizzle binds twice)', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForManagerView('mgr', {}, testDb);
    // Drizzle's `sql\`\`` template doesn't dedupe interpolations — the managerId is bound
    // once for `user_id = $1` and once for the subquery's `wum.user_id = $2`.
    expect(exec.calls[0].params).toEqual(['mgr', 'mgr', 200]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('work_unit_managers');
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('wum.user_id = $2');
  });

  test('with cursor: cursor params follow the manager scope params', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForManagerView(
      'mgr',
      { limit: 25, cursor: { createdAt: '2026-04-30 12:00:00.123456', id: 'e-9' } },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['mgr', 'mgr', '2026-04-30 12:00:00.123456', 'e-9', 25]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('$3::timestamp');
    expect(sql).toContain('LIMIT $5');
  });
});

describe('encodeCursor / decodeCursor', () => {
  test('round-trips a µs-precision Postgres timestamp cursor', () => {
    const encoded = entriesRepo.encodeCursor({
      createdAt: '2026-04-30 12:00:00.123456',
      id: 'e-1',
    });
    expect(entriesRepo.decodeCursor(encoded)).toEqual({
      createdAt: '2026-04-30 12:00:00.123456',
      id: 'e-1',
    });
  });

  test('returns null for malformed input', () => {
    expect(entriesRepo.decodeCursor('not base64')).toBeNull();
    expect(
      entriesRepo.decodeCursor(Buffer.from('garbage', 'utf8').toString('base64url')),
    ).toBeNull();
  });

  test('rejects legacy numeric createdAt cursors', () => {
    const legacy = Buffer.from(JSON.stringify({ createdAt: 12345, id: 'e-1' }), 'utf8').toString(
      'base64url',
    );
    expect(entriesRepo.decodeCursor(legacy)).toBeNull();
  });

  test.each([
    ['missing id', { createdAt: '2026-04-30 12:00:00.123456' }],
    ['missing createdAt', { id: 'e-1' }],
    ['non-string id', { createdAt: '2026-04-30 12:00:00.123456', id: 42 }],
    ['null payload', null],
    ['array payload', ['2026-04-30 12:00:00.123456', 'e-1']],
  ])('rejects %s', (_label, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    expect(entriesRepo.decodeCursor(encoded)).toBeNull();
  });

  test('produces a nextCursor that preserves µs precision from created_at_text', async () => {
    exec.enqueue({
      rows: [rawRow, { ...rawRow, id: 'e-2', created_at_text: '2026-04-30 12:00:00.123100' }],
    });
    const result = await entriesRepo.listAll({ limit: 2 }, testDb);
    expect(result.nextCursor).toEqual({
      createdAt: '2026-04-30 12:00:00.123100',
      id: 'e-2',
    });
  });
});

describe('findOwner', () => {
  test('returns owner id when entry exists', async () => {
    exec.enqueue({ rows: [['u-1']] });
    expect(await entriesRepo.findOwner('e-1', testDb)).toBe('u-1');
  });

  test('returns null when entry not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.findOwner('e-x', testDb)).toBeNull();
  });
});

describe('findContext', () => {
  test('returns full context including taskId when present', async () => {
    exec.enqueue({ rows: [['u-1', 'p-1', 'Dev', 't-1']] });
    expect(await entriesRepo.findContext('e-1', testDb)).toEqual({
      userId: 'u-1',
      projectId: 'p-1',
      task: 'Dev',
      taskId: 't-1',
    });
  });

  test('returns context with null taskId for orphaned entries', async () => {
    exec.enqueue({ rows: [['u-1', 'p-1', 'Dev', null]] });
    expect((await entriesRepo.findContext('e-1', testDb))?.taskId).toBeNull();
  });

  test('returns null when entry not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.findContext('e-x', testDb)).toBeNull();
  });
});

describe('create', () => {
  test('passes 14 params in expected order and returns mapped row', async () => {
    exec.enqueue({ rows: [entryRow()] });
    const result = await entriesRepo.create(
      {
        id: 'e-1',
        userId: 'u-1',
        date: '2026-04-30',
        clientId: 'c-1',
        clientName: 'Acme',
        projectId: 'p-1',
        projectName: 'Alpha',
        task: 'Dev',
        taskId: 't-1',
        notes: 'n',
        duration: 1.5,
        hourlyCost: 100,
        isPlaceholder: false,
        location: 'remote',
      },
      testDb,
    );
    expect(exec.calls[0].params).toEqual([
      'e-1',
      'u-1',
      '2026-04-30',
      'c-1',
      'Acme',
      'p-1',
      'Alpha',
      'Dev',
      't-1',
      'n',
      '1.5',
      '100',
      false,
      'remote',
    ]);
    expect(exec.calls[0].sql).toContain('returning');
    expect(result.duration).toBe(1.5);
    expect(result.hourlyCost).toBe(100);
    expect(result.userId).toBe('u-1');
    expect(result.taskId).toBe('t-1');
  });

  test('null taskId is passed through (task name has no matching task row)', async () => {
    exec.enqueue({ rows: [entryRow({ 8: null })] });
    const result = await entriesRepo.create(
      {
        id: 'e-1',
        userId: 'u-1',
        date: '2026-04-30',
        clientId: 'c-1',
        clientName: 'Acme',
        projectId: 'p-1',
        projectName: 'Alpha',
        task: 'Dev',
        taskId: null,
        notes: 'n',
        duration: 1.5,
        hourlyCost: 100,
        isPlaceholder: false,
        location: 'remote',
      },
      testDb,
    );
    expect(exec.calls[0].params[8]).toBeNull();
    expect(result.taskId).toBeNull();
  });
});

const newEntry = {
  id: 'e-1',
  userId: 'u-1',
  date: '2026-04-30',
  clientId: 'c-1',
  clientName: 'Acme',
  projectId: 'p-1',
  projectName: 'Alpha',
  task: 'Dev',
  taskId: 't-1',
  notes: 'n',
  duration: 1.5,
  hourlyCost: 100,
  isPlaceholder: false,
  location: 'remote',
};

describe('mapBuilderRow (exercised via create return path)', () => {
  test('null duration falls back to 0', async () => {
    exec.enqueue({ rows: [entryRow({ 10: null })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.duration).toBe(0);
  });

  test('null hourly_cost falls back to 0', async () => {
    exec.enqueue({ rows: [entryRow({ 11: null })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.hourlyCost).toBe(0);
  });

  test('null is_placeholder coerces to false', async () => {
    exec.enqueue({ rows: [entryRow({ 12: null })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.isPlaceholder).toBe(false);
  });

  test('null location falls back to "remote"', async () => {
    exec.enqueue({ rows: [entryRow({ 13: null })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.location).toBe('remote');
  });

  test('empty location falls back to "remote"', async () => {
    exec.enqueue({ rows: [entryRow({ 13: '' })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.location).toBe('remote');
  });

  test('numeric-string duration is parsed to number', async () => {
    exec.enqueue({ rows: [entryRow({ 10: '2.75' })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.duration).toBe(2.75);
  });

  test('null createdAt falls back to 0', async () => {
    exec.enqueue({ rows: [entryRow({ 14: null })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.createdAt).toBe(0);
  });

  test('throws TypeError when row.date is null', async () => {
    exec.enqueue({ rows: [entryRow({ 2: null })] });
    expect(entriesRepo.create(newEntry, testDb)).rejects.toThrow(TypeError);
  });
});

describe('update', () => {
  test('only sets provided fields, id is the last param', async () => {
    exec.enqueue({ rows: [entryRow()] });
    const result = await entriesRepo.update('e-1', { duration: 2 }, testDb);
    expect(result?.id).toBe('e-1');
    expect(result?.userId).toBe('u-1');
    expect(result?.duration).toBe(1.5);
    expect(result?.hourlyCost).toBe(100);
    expect(result?.isPlaceholder).toBe(false);
    expect(exec.calls[0].sql).toContain('"duration" = $1');
    expect(exec.calls[0].sql).toContain('"id" = $2');
    expect(exec.calls[0].params).toEqual(['2', 'e-1']);
  });

  test('builds SET list in schema column order from defined fields', async () => {
    exec.enqueue({ rows: [entryRow()] });
    await entriesRepo.update(
      'e-1',
      { duration: 2, notes: 'updated', isPlaceholder: true, location: 'office', taskId: 't-2' },
      testDb,
    );
    // Drizzle emits SET columns in schema column declaration order regardless of how the
    // `.set({...})` object is constructed: task_id (col 9) → notes (10) → duration (11) →
    // is_placeholder (13) → location (14).
    const sql = exec.calls[0].sql;
    expect(sql).toContain('"task_id" = $1');
    expect(sql).toContain('"notes" = $2');
    expect(sql).toContain('"duration" = $3');
    expect(sql).toContain('"is_placeholder" = $4');
    expect(sql).toContain('"location" = $5');
    expect(sql).toContain('"id" = $6');
    expect(exec.calls[0].params).toEqual(['t-2', 'updated', '2', true, 'office', 'e-1']);
  });

  test('passes taskId through when set, omitting other fields', async () => {
    exec.enqueue({ rows: [entryRow()] });
    await entriesRepo.update('e-1', { taskId: 't-2' }, testDb);
    expect(exec.calls[0].sql).toContain('"task_id" = $1');
    expect(exec.calls[0].sql).toContain('"id" = $2');
    expect(exec.calls[0].params).toEqual(['t-2', 'e-1']);
  });

  test('omitting all fields falls back to a SELECT (no UPDATE issued)', async () => {
    exec.enqueue({ rows: [entryRow()] });
    const result = await entriesRepo.update('e-1', {}, testDb);
    expect(exec.calls[0].sql).not.toContain('update');
    expect(exec.calls[0].sql).toContain('select');
    expect(exec.calls[0].params).toEqual(['e-1']);
    expect(result?.id).toBe('e-1');
  });

  test('returns null when no row matched (UPDATE path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.update('e-x', { duration: 2 }, testDb)).toBeNull();
  });

  test('returns null when no row matched (SELECT fallback path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.update('e-x', {}, testDb)).toBeNull();
  });

  test('notes: null clears the column (distinct from undefined which is skipped)', async () => {
    exec.enqueue({ rows: [entryRow({ 9: null })] });
    const result = await entriesRepo.update('e-1', { notes: null }, testDb);
    expect(exec.calls[0].sql).toContain('update');
    expect(exec.calls[0].sql).toContain('"notes" = $1');
    expect(exec.calls[0].sql).toContain('"id" = $2');
    expect(exec.calls[0].params).toEqual([null, 'e-1']);
    expect(result?.notes).toBeNull();
  });
});

describe('deleteById', () => {
  test('passes id as $1 against time_entries', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.deleteById('e-1', testDb);
    expect(exec.calls[0].params).toEqual(['e-1']);
    expect(exec.calls[0].sql).toContain('delete from "time_entries"');
    expect(exec.calls[0].sql).toContain('"id" = $1');
  });
});

describe('bulkDelete', () => {
  test('minimal filters: project + task only, returns row count', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    const result = await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev' }, testDb);
    expect(result).toBe(2);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev']);
    expect(exec.calls[0].sql).toContain('"project_id" = $1');
    expect(exec.calls[0].sql).toContain('"task" = $2');
    expect(exec.calls[0].sql).not.toContain('returning');
    expect(exec.calls[0].sql).not.toContain('user_id');
    expect(exec.calls[0].sql).not.toContain('"date"');
    expect(exec.calls[0].sql).not.toContain('is_placeholder');
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    const result = await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev' }, testDb);
    expect(result).toBe(0);
  });

  test('manager-scope restriction adds the user_id subquery (managerId bound twice)', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete(
      { projectId: 'p-1', task: 'Dev', restrictToManagerScopeOf: 'mgr' },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', 'mgr', 'mgr']);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('user_id = $3');
    expect(sql).toContain('wum.user_id = $4');
  });

  test('fromDate appends date filter at the next index', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev', fromDate: '2026-04-30' }, testDb);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', '2026-04-30']);
    expect(exec.calls[0].sql).toContain('"date" >= $3');
  });

  test('manager-scope + fromDate uses sequential indexes', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete(
      {
        projectId: 'p-1',
        task: 'Dev',
        restrictToManagerScopeOf: 'mgr',
        fromDate: '2026-04-30',
      },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', 'mgr', 'mgr', '2026-04-30']);
    expect(exec.calls[0].sql).toContain('"date" >= $5');
  });

  test('placeholderOnly: true binds `is_placeholder = $N` with true', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev', placeholderOnly: true }, testDb);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', true]);
    expect(exec.calls[0].sql).toContain('"is_placeholder" = $3');
  });

  test('placeholderOnly: false does NOT add the predicate (gated on === true)', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev', placeholderOnly: false }, testDb);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev']);
    expect(exec.calls[0].sql).not.toContain('is_placeholder');
  });

  test('all filters together: manager scope + fromDate + placeholderOnly', async () => {
    exec.enqueue({ rows: [], rowCount: 5 });
    const result = await entriesRepo.bulkDelete(
      {
        projectId: 'p-1',
        task: 'Dev',
        restrictToManagerScopeOf: 'mgr',
        fromDate: '2026-04-30',
        placeholderOnly: true,
      },
      testDb,
    );
    expect(result).toBe(5);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', 'mgr', 'mgr', '2026-04-30', true]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('"project_id" = $1');
    expect(sql).toContain('"task" = $2');
    expect(sql).toContain('user_id = $3');
    expect(sql).toContain('wum.user_id = $4');
    expect(sql).toContain('"date" >= $5');
    expect(sql).toContain('"is_placeholder" = $6');
  });
});
