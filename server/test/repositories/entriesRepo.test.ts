import { beforeEach, describe, expect, test } from 'bun:test';
import * as entriesRepo from '../../repositories/entriesRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('listAll', () => {
  test('passes default limit and no cursor', async () => {
    exec.enqueue({ rows: [] });
    const result = await entriesRepo.listAll({}, exec);
    expect(exec.calls[0].params).toEqual([200]);
    expect(exec.calls[0].sql).toContain('LIMIT $1');
    expect(result.nextCursor).toBeNull();
  });

  test('caps limit at 500', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll({ limit: 9999 }, exec);
    expect(exec.calls[0].params).toEqual([500]);
  });

  test('cursor adds (created_at, id) < tuple comparison with µs-precision timestamp', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listAll(
      { limit: 50, cursor: { createdAt: '2026-04-30 12:00:00.123456', id: 'e-1' } },
      exec,
    );
    expect(exec.calls[0].params).toEqual(['2026-04-30 12:00:00.123456', 'e-1', 50]);
    expect(exec.calls[0].sql).toContain('::timestamp');
    expect(exec.calls[0].sql).not.toContain('to_timestamp');
  });
});

describe('listForUser', () => {
  test('passes userId as $1 and limit at the end', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForUser('u-1', {}, exec);
    expect(exec.calls[0].params).toEqual(['u-1', 200]);
    expect(exec.calls[0].sql).toContain('WHERE user_id = $1');
  });
});

describe('listForManagerView', () => {
  test('uses managerId for both own + managed subquery', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.listForManagerView('mgr', {}, exec);
    expect(exec.calls[0].params).toEqual(['mgr', 200]);
    expect(exec.calls[0].sql).toContain('work_unit_managers');
    expect(exec.calls[0].sql).toContain('user_id = $1');
    expect(exec.calls[0].sql).toContain('wum.user_id = $1');
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

  test('produces a nextCursor that preserves µs precision from created_at_text', async () => {
    const row = {
      id: 'e-2',
      user_id: 'u-1',
      date: '2026-04-30',
      client_id: 'c-1',
      client_name: 'Acme',
      project_id: 'p-1',
      project_name: 'Alpha',
      task: 'Dev',
      task_id: 't-1',
      notes: null,
      duration: 1,
      hourly_cost: 100,
      is_placeholder: false,
      location: 'remote',
      created_at: new Date('2026-04-30T12:00:00.123Z'),
      created_at_text: '2026-04-30 12:00:00.123456',
    };
    exec.enqueue({
      rows: [row, { ...row, id: 'e-1', created_at_text: '2026-04-30 12:00:00.123100' }],
    });
    const result = await entriesRepo.listAll({ limit: 2 }, exec);
    expect(result.nextCursor).toEqual({
      createdAt: '2026-04-30 12:00:00.123100',
      id: 'e-1',
    });
  });
});

describe('findOwner', () => {
  test('returns owner id when entry exists', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }] });
    expect(await entriesRepo.findOwner('e-1', exec)).toBe('u-1');
  });

  test('returns null when entry not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.findOwner('e-x', exec)).toBeNull();
  });
});

describe('findContext', () => {
  test('returns full context including taskId when present', async () => {
    exec.enqueue({
      rows: [{ user_id: 'u-1', project_id: 'p-1', task: 'Dev', task_id: 't-1' }],
    });
    expect(await entriesRepo.findContext('e-1', exec)).toEqual({
      userId: 'u-1',
      projectId: 'p-1',
      task: 'Dev',
      taskId: 't-1',
    });
  });

  test('returns context with null taskId for orphaned entries', async () => {
    exec.enqueue({
      rows: [{ user_id: 'u-1', project_id: 'p-1', task: 'Dev', task_id: null }],
    });
    expect((await entriesRepo.findContext('e-1', exec))?.taskId).toBeNull();
  });

  test('returns null when entry not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.findContext('e-x', exec)).toBeNull();
  });
});

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
};

describe('create', () => {
  test('passes 14 params in expected order and returns mapped row', async () => {
    exec.enqueue({ rows: [rawRow] });
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
      exec,
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
      1.5,
      100,
      false,
      'remote',
    ]);
    expect(exec.calls[0].sql).toContain('RETURNING');
    expect(result.duration).toBe(1.5);
    expect(result.hourlyCost).toBe(100);
    expect(result.userId).toBe('u-1');
    expect(result.taskId).toBe('t-1');
  });

  test('null taskId is passed through (task name has no matching task row)', async () => {
    exec.enqueue({ rows: [{ ...rawRow, task_id: null }] });
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
      exec,
    );
    expect(exec.calls[0].params[8]).toBeNull();
    expect(result.taskId).toBeNull();
  });
});

describe('update', () => {
  test('only sets provided fields, id is the last param', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await entriesRepo.update('e-1', { duration: 2 }, exec);
    expect(result?.id).toBe('e-1');
    expect(result?.userId).toBe('u-1');
    expect(result?.duration).toBe(1.5);
    expect(result?.hourlyCost).toBe(100);
    expect(result?.isPlaceholder).toBe(false);
    expect(exec.calls[0].sql).toContain('SET duration = $1');
    expect(exec.calls[0].sql).toContain('WHERE id = $2');
    expect(exec.calls[0].params).toEqual([2, 'e-1']);
  });

  test('builds SET list in column order from defined fields', async () => {
    exec.enqueue({ rows: [rawRow] });
    await entriesRepo.update(
      'e-1',
      { duration: 2, notes: 'updated', isPlaceholder: true, location: 'office', taskId: 't-2' },
      exec,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('duration = $1');
    expect(sql).toContain('notes = $2');
    expect(sql).toContain('is_placeholder = $3');
    expect(sql).toContain('location = $4');
    expect(sql).toContain('task_id = $5');
    expect(sql).toContain('WHERE id = $6');
    expect(exec.calls[0].params).toEqual([2, 'updated', true, 'office', 't-2', 'e-1']);
  });

  test('passes taskId through when set, omitting other fields', async () => {
    exec.enqueue({ rows: [rawRow] });
    await entriesRepo.update('e-1', { taskId: 't-2' }, exec);
    expect(exec.calls[0].sql).toContain('SET task_id = $1');
    expect(exec.calls[0].sql).toContain('WHERE id = $2');
    expect(exec.calls[0].params).toEqual(['t-2', 'e-1']);
  });

  test('omitting all fields falls back to a SELECT (no UPDATE issued)', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await entriesRepo.update('e-1', {}, exec);
    expect(exec.calls[0].sql).not.toContain('UPDATE');
    expect(exec.calls[0].sql).toContain('SELECT');
    expect(exec.calls[0].params).toEqual(['e-1']);
    expect(result?.id).toBe('e-1');
  });

  test('returns null when no row matched (UPDATE path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.update('e-x', { duration: 2 }, exec)).toBeNull();
  });

  test('returns null when no row matched (SELECT fallback path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await entriesRepo.update('e-x', {}, exec)).toBeNull();
  });
});

describe('deleteById', () => {
  test('passes id as $1', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.deleteById('e-1', exec);
    expect(exec.calls[0].params).toEqual(['e-1']);
  });
});

describe('bulkDelete', () => {
  test('minimal filters: project + task only, returns row count', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    const result = await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev' }, exec);
    expect(result).toBe(2);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev']);
    expect(exec.calls[0].sql).toContain('project_id = $1');
    expect(exec.calls[0].sql).toContain('task = $2');
    expect(exec.calls[0].sql).not.toContain('RETURNING');
    expect(exec.calls[0].sql).not.toContain('user_id =');
    expect(exec.calls[0].sql).not.toContain('date >=');
    expect(exec.calls[0].sql).not.toContain('is_placeholder');
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    const result = await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev' }, exec);
    expect(result).toBe(0);
  });

  test('manager-scope restriction adds the user_id subquery, reusing $3', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete(
      { projectId: 'p-1', task: 'Dev', restrictToManagerScopeOf: 'mgr' },
      exec,
    );
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', 'mgr']);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('user_id = $3');
    expect(sql).toContain('wum.user_id = $3');
  });

  test('fromDate appends date filter at the next index', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev', fromDate: '2026-04-30' }, exec);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', '2026-04-30']);
    expect(exec.calls[0].sql).toContain('date >= $3');
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
      exec,
    );
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev', 'mgr', '2026-04-30']);
    expect(exec.calls[0].sql).toContain('date >= $4');
  });

  test('placeholderOnly is appended as a literal predicate (no param)', async () => {
    exec.enqueue({ rows: [] });
    await entriesRepo.bulkDelete({ projectId: 'p-1', task: 'Dev', placeholderOnly: true }, exec);
    expect(exec.calls[0].params).toEqual(['p-1', 'Dev']);
    expect(exec.calls[0].sql).toContain('is_placeholder = true');
  });
});
