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
// cursor pagination - see ENTRY_COLUMNS_SQL).
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

  test('fromDate/toDate add inclusive date clauses before limit', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll({ fromDate: '2026-05-01', toDate: '2026-05-31' }, testDb);
    expect(exec.calls[0].params).toEqual(['2026-05-01', '2026-05-31', 200]);
    expect(exec.calls[0].sql).toContain('date >= $1::date');
    expect(exec.calls[0].sql).toContain('date <= $2::date');
    expect(exec.calls[0].sql).toContain('LIMIT $3');
  });

  test('date range and project filters can be combined', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll(
      { fromDate: '2026-05-01', toDate: '2026-05-31', projectId: 'p-1' },
      testDb,
    );

    expect(exec.calls[0].params).toEqual(['2026-05-01', '2026-05-31', 'p-1', 200]);
    expect(exec.calls[0].sql).toContain('date >= $1::date');
    expect(exec.calls[0].sql).toContain('date <= $2::date');
    expect(exec.calls[0].sql).toContain('project_id = $3');
    expect(exec.calls[0].sql).toContain('LIMIT $4');
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

  test('with date range: date params follow userId and cursor stays after dates', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForUser(
      'u-1',
      {
        fromDate: '2026-05-01',
        toDate: '2026-05-31',
        cursor: { createdAt: '2026-05-30 12:00:00.123456', id: 'e-9' },
      },
      testDb,
    );
    expect(exec.calls[0].params).toEqual([
      'u-1',
      '2026-05-01',
      '2026-05-31',
      '2026-05-30 12:00:00.123456',
      'e-9',
      200,
    ]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('date >= $2::date');
    expect(sql).toContain('date <= $3::date');
    expect(sql).toContain('$4::timestamp');
    expect(sql).toContain('LIMIT $6');
  });
});

describe('listForManagerView', () => {
  test('uses managerId for both own + managed subquery (Drizzle binds twice)', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForManagerView('mgr', {}, testDb);
    // Drizzle's `sql\`\`` template doesn't dedupe interpolations - the managerId is bound
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

  test('with date range: date params follow manager scope params', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForManagerView(
      'mgr',
      { limit: 25, fromDate: '2026-05-01', toDate: '2026-05-31' },
      testDb,
    );
    expect(exec.calls[0].params).toEqual(['mgr', 'mgr', '2026-05-01', '2026-05-31', 25]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('date >= $3::date');
    expect(sql).toContain('date <= $4::date');
    expect(sql).toContain('LIMIT $5');
  });
});

describe('sumDurationsByOwnerDate helpers', () => {
  test('sumDurationsByOwnerDateForUser groups full-range durations without pagination', async () => {
    exec.enqueue({
      rows: [
        { user_id: 'u-1', date: '2026-05-04', duration: '9.00' },
        { user_id: 'u-1', date: '2026-05-05', duration: '4.50' },
      ],
    });

    const result = await entriesRepo.sumDurationsByOwnerDateForUser(
      'u-1',
      { fromDate: '2026-05-01', toDate: '2026-05-31', projectId: 'p-1' },
      testDb,
    );

    expect(result).toEqual(
      new Map([
        [entriesRepo.dailyDurationOwnerDateKey('u-1', '2026-05-04'), 9],
        [entriesRepo.dailyDurationOwnerDateKey('u-1', '2026-05-05'), 4.5],
      ]),
    );
    expect(exec.calls[0].params).toEqual(['u-1', '2026-05-01', '2026-05-31', 'p-1']);
    expect(exec.calls[0].sql).toContain('SELECT user_id, date');
    expect(exec.calls[0].sql).toContain('COALESCE(SUM(duration), 0) AS duration');
    expect(exec.calls[0].sql).toContain('GROUP BY user_id, date');
    expect(exec.calls[0].sql).not.toContain('LIMIT');
    expect(exec.calls[0].sql).not.toContain('created_at');
  });

  test('sumDurationsByOwnerDateForManagerView preserves manager scoping', async () => {
    exec.enqueue({ rows: [] });

    await entriesRepo.sumDurationsByOwnerDateForManagerView(
      'mgr',
      { fromDate: '2026-05-01', toDate: '2026-05-31' },
      testDb,
    );

    expect(exec.calls[0].params).toEqual(['mgr', 'mgr', '2026-05-01', '2026-05-31']);
    expect(exec.calls[0].sql).toContain('user_id = $1');
    expect(exec.calls[0].sql).toContain('wum.user_id = $2');
    expect(exec.calls[0].sql).toContain('GROUP BY user_id, date');
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

  test('null created_at_text on the last row suppresses nextCursor', async () => {
    exec.enqueue({
      rows: [rawRow, { ...rawRow, id: 'e-2', created_at: null, created_at_text: null }],
    });
    const result = await entriesRepo.listAll({ limit: 2 }, testDb);
    expect(result.entries).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});

describe('mapRawRow (exercised via listAll return path)', () => {
  test('null created_at falls back to 0 (matches mapBuilderRow)', async () => {
    exec.enqueue({ rows: [{ ...rawRow, created_at: null, created_at_text: null }] });
    const result = await entriesRepo.listAll({}, testDb);
    expect(result.entries[0].createdAt).toBe(0);
  });

  test('cost is surfaced on the raw-SQL read path (duration * hourly_cost, rounded)', async () => {
    // 1.5h * $100 = $150
    exec.enqueue({ rows: [rawRow] });
    const result = await entriesRepo.listAll({}, testDb);
    expect(result.entries[0].duration).toBe(1.5);
    expect(result.entries[0].hourlyCost).toBe(100);
    expect(result.entries[0].cost).toBe(150);
  });

  test('cost is 0 when hourly_cost is null on a raw row', async () => {
    exec.enqueue({ rows: [{ ...rawRow, hourly_cost: null }] });
    const result = await entriesRepo.listAll({}, testDb);
    expect(result.entries[0].hourlyCost).toBe(0);
    expect(result.entries[0].cost).toBe(0);
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
    exec.enqueue({
      rows: [['u-1', '2026-04-30', 'c-1', 'Acme', 'p-1', 'Alpha', 'Dev', 't-1']],
    });
    expect(await entriesRepo.findContext('e-1', testDb)).toEqual({
      userId: 'u-1',
      date: '2026-04-30',
      clientId: 'c-1',
      clientName: 'Acme',
      projectId: 'p-1',
      projectName: 'Alpha',
      task: 'Dev',
      taskId: 't-1',
    });
  });

  test('returns context with null taskId for orphaned entries', async () => {
    exec.enqueue({
      rows: [['u-1', '2026-04-30', 'c-1', 'Acme', 'p-1', 'Alpha', 'Dev', null]],
    });
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
    expect(result.cost).toBe(150);
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

describe('createMany', () => {
  test('returns an empty array without issuing a query for empty input', async () => {
    const result = await entriesRepo.createMany([], testDb);
    expect(result).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  test('inserts multiple rows in a single query and returns mapped rows', async () => {
    exec.enqueue({
      rows: [entryRow(), entryRow({ 0: 'e-2', 2: '2026-05-01' })],
    });
    const result = await entriesRepo.createMany(
      [
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
          notes: null,
          duration: 1.5,
          hourlyCost: 100,
          isPlaceholder: true,
          location: 'remote',
        },
        {
          id: 'e-2',
          userId: 'u-1',
          date: '2026-05-01',
          clientId: 'c-1',
          clientName: 'Acme',
          projectId: 'p-1',
          projectName: 'Alpha',
          task: 'Dev',
          taskId: 't-1',
          notes: null,
          duration: 2,
          hourlyCost: 100,
          isPlaceholder: true,
          location: 'remote',
        },
      ],
      testDb,
    );
    // Single INSERT with two value-tuples => 14 params per row * 2 rows.
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toHaveLength(28);
    expect(exec.calls[0].sql).toContain('returning');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('e-1');
    expect(result[1].id).toBe('e-2');
  });

  test('chunks inserts at 1000 rows to stay under PG bind-parameter limits', async () => {
    // 2500 entries -> 3 chunks: 1000 + 1000 + 500.
    const inputs = Array.from({ length: 2500 }, (_, i) => ({
      id: `e-${i}`,
      userId: 'u-1',
      date: '2026-04-30',
      clientId: 'c-1',
      clientName: 'Acme',
      projectId: 'p-1',
      projectName: 'Alpha',
      task: 'Dev',
      taskId: 't-1',
      notes: null,
      duration: 1,
      hourlyCost: 100,
      isPlaceholder: true,
      location: 'remote',
    }));
    exec.enqueue({ rows: inputs.slice(0, 1000).map((i) => entryRow({ 0: i.id })) });
    exec.enqueue({ rows: inputs.slice(1000, 2000).map((i) => entryRow({ 0: i.id })) });
    exec.enqueue({ rows: inputs.slice(2000, 2500).map((i) => entryRow({ 0: i.id })) });

    const result = await entriesRepo.createMany(inputs, testDb);

    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[0].params).toHaveLength(14_000);
    expect(exec.calls[1].params).toHaveLength(14_000);
    expect(exec.calls[2].params).toHaveLength(7_000);
    expect(result).toHaveLength(2500);
    expect(result[0].id).toBe('e-0');
    expect(result[2499].id).toBe('e-2499');
  });
});

describe('findExistingRecurringKeys', () => {
  test('returns a Set keyed by date|projectId|task for matching rows', async () => {
    // Drizzle returns SELECT rows as positional arrays in projection order:
    // [date, projectId, task] for our select.
    exec.enqueue({
      rows: [
        ['2026-04-30', 'p-1', 'Dev'],
        ['2026-05-01', 'p-1', 'Dev'],
        ['2026-05-02', 'p-2', 'Review'],
      ],
    });
    const result = await entriesRepo.findExistingRecurringKeys(
      'u-1',
      '2026-04-30',
      '2026-05-02',
      testDb,
    );
    expect(result).toEqual(
      new Set(['2026-04-30|p-1|Dev', '2026-05-01|p-1|Dev', '2026-05-02|p-2|Review']),
    );
    expect(exec.calls[0].params).toEqual(['u-1', '2026-04-30', '2026-05-02']);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('user_id');
    expect(sql).toContain('date');
  });

  test('returns an empty Set when no rows match', async () => {
    exec.enqueue({ rows: [] });
    const result = await entriesRepo.findExistingRecurringKeys(
      'u-1',
      '2026-04-30',
      '2026-05-02',
      testDb,
    );
    expect(result.size).toBe(0);
  });
});

describe('existsForEntryKey', () => {
  test('checks the full user/date/project/task tuple and returns true when found', async () => {
    exec.enqueue({ rows: [['e-1']] });

    const result = await entriesRepo.existsForEntryKey(
      { userId: 'u-1', date: '2026-04-30', projectId: 'p-1', task: 'Dev' },
      testDb,
    );

    expect(result).toBe(true);
    expect(exec.calls[0].params).toEqual(['u-1', '2026-04-30', 'p-1', 'Dev', 1]);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('user_id');
    expect(sql).toContain('project_id');
    expect(sql).toContain('task');
    expect(sql).toContain('limit $5');
  });

  test('returns false when no matching tuple exists', async () => {
    exec.enqueue({ rows: [] });

    const result = await entriesRepo.existsForEntryKey(
      { userId: 'u-1', date: '2026-04-30', projectId: 'p-1', task: 'Dev' },
      testDb,
    );

    expect(result).toBe(false);
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
    expect(result.cost).toBe(0);
  });

  test('cost is computed on read as duration * hourly_cost (rounded)', async () => {
    // duration=2.5h, hourly_cost=$73.20 -> 183.00
    exec.enqueue({ rows: [entryRow({ 10: '2.5', 11: '73.20' })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.duration).toBe(2.5);
    expect(result.hourlyCost).toBe(73.2);
    expect(result.cost).toBe(183);
  });

  test('cost rounds to currency precision', async () => {
    // 1h * 0.015 = 0.015 -> rounds half-up to 0.02
    exec.enqueue({ rows: [entryRow({ 10: '1', 11: '0.015' })] });
    const result = await entriesRepo.create(newEntry, testDb);
    expect(result.cost).toBe(0.02);
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
    await expect(entriesRepo.create(newEntry, testDb)).rejects.toThrow(TypeError);
  });
});

describe('update', () => {
  test('only sets provided fields and filters by id plus expected version', async () => {
    exec.enqueue({ rows: [entryRow({ 15: 2 })] });
    const result = await entriesRepo.update('e-1', { version: 1, duration: 2 }, testDb);
    expect(result?.id).toBe('e-1');
    expect(result?.userId).toBe('u-1');
    expect(result?.duration).toBe(1.5);
    expect(result?.hourlyCost).toBe(100);
    expect(result?.isPlaceholder).toBe(false);
    expect(result?.version).toBe(2);
    expect(exec.calls[0].sql).toContain('"duration" = $1');
    expect(exec.calls[0].sql).toContain('"id" = $2');
    expect(exec.calls[0].sql).toContain('"version" = $3');
    expect(exec.calls[0].params).toEqual(['2', 'e-1', 1]);
  });

  test('builds SET list in schema column order from defined fields', async () => {
    exec.enqueue({ rows: [entryRow()] });
    await entriesRepo.update(
      'e-1',
      {
        version: 1,
        duration: 2,
        notes: 'updated',
        isPlaceholder: true,
        location: 'office',
        taskId: 't-2',
      },
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
    expect(sql).toContain('"version" = $7');
    expect(exec.calls[0].params).toEqual(['t-2', 'updated', '2', true, 'office', 'e-1', 1]);
  });

  test('passes taskId through when set, omitting other fields', async () => {
    exec.enqueue({ rows: [entryRow()] });
    await entriesRepo.update('e-1', { version: 1, taskId: 't-2' }, testDb);
    expect(exec.calls[0].sql).toContain('"task_id" = $1');
    expect(exec.calls[0].sql).toContain('"id" = $2');
    expect(exec.calls[0].sql).toContain('"version" = $3');
    expect(exec.calls[0].params).toEqual(['t-2', 'e-1', 1]);
  });

  test('omitting all fields falls back to a SELECT (no UPDATE issued)', async () => {
    exec.enqueue({ rows: [entryRow()] });
    const result = await entriesRepo.update('e-1', { version: 1 }, testDb);
    expect(exec.calls[0].sql).not.toContain('update');
    expect(exec.calls[0].sql).toContain('select');
    expect(exec.calls[0].sql).toContain('"version" = $2');
    expect(exec.calls[0].params).toEqual(['e-1', 1]);
    expect(result?.id).toBe('e-1');
  });

  test('returns null when no row matched (UPDATE path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.update('e-x', { version: 1, duration: 2 }, testDb)).toBeNull();
  });

  test('returns null when no row matched (SELECT fallback path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.update('e-x', { version: 1 }, testDb)).toBeNull();
  });

  test('notes: null clears the column (distinct from undefined which is skipped)', async () => {
    exec.enqueue({ rows: [entryRow({ 9: null })] });
    const result = await entriesRepo.update('e-1', { version: 1, notes: null }, testDb);
    expect(exec.calls[0].sql).toContain('update');
    expect(exec.calls[0].sql).toContain('"notes" = $1');
    expect(exec.calls[0].sql).toContain('"id" = $2');
    expect(exec.calls[0].sql).toContain('"version" = $3');
    expect(exec.calls[0].params).toEqual([null, 'e-1', 1]);
    expect(result?.notes).toBeNull();
  });

  test('stale expected version returns null instead of overwriting', async () => {
    exec.enqueue({ rows: [] });
    const result = await entriesRepo.update('e-1', { version: 1, duration: 2 }, testDb);
    expect(result).toBeNull();
    const sql = exec.calls[0].sql;
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('"version" = $3');
    expect(exec.calls[0].params).toEqual(['2', 'e-1', 1]);
  });
});

describe('reassignProjectClient', () => {
  test('updates the denormalized client fields and version for every project entry', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });

    await entriesRepo.reassignProjectClient('p-1', { id: 'c-own', name: 'Praetor S.r.l.' }, testDb);

    expect(exec.calls[0].sql).toContain('update "time_entries"');
    expect(exec.calls[0].sql).toContain('"client_id" = $1');
    expect(exec.calls[0].sql).toContain('"client_name" = $2');
    expect(exec.calls[0].sql).toContain('"version" = "time_entries"."version" + 1');
    expect(exec.calls[0].sql).toContain('"project_id" = $3');
    expect(exec.calls[0].params).toEqual(['c-own', 'Praetor S.r.l.', 'p-1']);
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
