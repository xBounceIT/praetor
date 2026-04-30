import { beforeEach, describe, expect, test } from 'bun:test';
import * as tasksRepo from '../../repositories/tasksRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawRow = {
  id: 't-1',
  name: 'Build feature',
  project_id: 'p-1',
  description: 'desc',
  is_recurring: false,
  recurrence_pattern: null,
  recurrence_start: null,
  recurrence_end: null,
  recurrence_duration: '0',
  expected_effort: '5',
  revenue: '120.5',
  notes: 'n',
  is_disabled: false,
};

describe('listAll', () => {
  test('returns mapped rows with parsed numerics', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await tasksRepo.listAll(exec);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 't-1',
      name: 'Build feature',
      projectId: 'p-1',
      isRecurring: false,
      recurrenceDuration: 0,
      expectedEffort: 5,
      revenue: 120.5,
      isDisabled: false,
    });
  });

  test('expectedEffort/revenue are undefined when DB value is null', async () => {
    exec.enqueue({ rows: [{ ...rawRow, expected_effort: null, revenue: null }] });
    const result = await tasksRepo.listAll(exec);
    expect(result[0].expectedEffort).toBeUndefined();
    expect(result[0].revenue).toBeUndefined();
  });

  test('notes maps null to undefined', async () => {
    exec.enqueue({ rows: [{ ...rawRow, notes: null }] });
    const result = await tasksRepo.listAll(exec);
    expect(result[0].notes).toBeUndefined();
  });

  test('numeric values pass through unchanged', async () => {
    exec.enqueue({ rows: [{ ...rawRow, recurrence_duration: 1.5, expected_effort: 8 }] });
    const result = await tasksRepo.listAll(exec);
    expect(result[0].recurrenceDuration).toBe(1.5);
    expect(result[0].expectedEffort).toBe(8);
  });
});

describe('listForUser', () => {
  test('joins user_tasks and passes userId as $1', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.listForUser('u-1', exec);
    expect(exec.calls[0].sql).toContain('INNER JOIN user_tasks');
    expect(exec.calls[0].params).toEqual(['u-1']);
  });
});

describe('create', () => {
  test('passes 12 params in column order', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.create(
      {
        id: 't-1',
        name: 'Build',
        projectId: 'p-1',
        description: 'd',
        isRecurring: true,
        recurrencePattern: 'WEEKLY',
        recurrenceStart: '2026-04-30',
        recurrenceDuration: 1,
        expectedEffort: 5,
        revenue: 100,
        notes: null,
        isDisabled: false,
      },
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      't-1',
      'Build',
      'p-1',
      'd',
      true,
      'WEEKLY',
      '2026-04-30',
      1,
      5,
      100,
      null,
      false,
    ]);
  });
});

describe('update', () => {
  test('only sets provided fields, id is the last param', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await tasksRepo.update('t-1', { name: 'Renamed' }, exec);
    expect(result?.id).toBe('t-1');
    expect(exec.calls[0].sql).toContain('SET name = $1');
    expect(exec.calls[0].sql).toContain('WHERE id = $2');
    expect(exec.calls[0].params).toEqual(['Renamed', 't-1']);
  });

  test('omitting all fields falls back to SELECT', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await tasksRepo.update('t-1', {}, exec);
    expect(exec.calls[0].sql).not.toContain('UPDATE');
    expect(exec.calls[0].sql).toContain('SELECT');
    expect(result?.id).toBe('t-1');
  });

  test('explicit null clears nullable columns', async () => {
    exec.enqueue({ rows: [rawRow] });
    await tasksRepo.update('t-1', { description: null, notes: null }, exec);
    expect(exec.calls[0].sql).toContain('description = $1');
    expect(exec.calls[0].sql).toContain('notes = $2');
    expect(exec.calls[0].params).toEqual([null, null, 't-1']);
  });

  test('returns null when UPDATE finds no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.update('t-x', { name: 'X' }, exec)).toBeNull();
  });
});

describe('deleteById', () => {
  test('returns mapped object when row deleted', async () => {
    exec.enqueue({ rows: [{ name: 'Build', project_id: 'p-1' }] });
    const result = await tasksRepo.deleteById('t-1', exec);
    expect(result).toEqual({ name: 'Build', projectId: 'p-1' });
  });

  test('returns null when nothing deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.deleteById('t-x', exec)).toBeNull();
  });
});

describe('findAssignedUserIds', () => {
  test('maps user_id rows to a string array', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }, { user_id: 'u-2' }] });
    expect(await tasksRepo.findAssignedUserIds('t-1', exec)).toEqual(['u-1', 'u-2']);
  });
});

describe('findNameAndProjectId', () => {
  test('returns mapped object when found', async () => {
    exec.enqueue({ rows: [{ name: 'Build', project_id: 'p-1' }] });
    expect(await tasksRepo.findNameAndProjectId('t-1', exec)).toEqual({
      name: 'Build',
      projectId: 'p-1',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.findNameAndProjectId('t-x', exec)).toBeNull();
  });
});

describe('clearUserAssignments / addUserAssignments', () => {
  test('clearUserAssignments passes taskId', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.clearUserAssignments('t-1', exec);
    expect(exec.calls[0].params).toEqual(['t-1']);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_tasks');
  });

  test('addUserAssignments skips query when userIds is empty', async () => {
    await tasksRepo.addUserAssignments('t-1', [], exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('addUserAssignments passes [taskId, userIds] and uses ON CONFLICT DO NOTHING', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.addUserAssignments('t-1', ['u-1', 'u-2'], exec);
    expect(exec.calls[0].params).toEqual(['t-1', ['u-1', 'u-2']]);
    expect(exec.calls[0].sql).toContain('ON CONFLICT DO NOTHING');
  });
});

describe('hours aggregation', () => {
  test('sumHoursByProjects (no user) passes ids array as $1, returns mapped rows with numeric totals', async () => {
    exec.enqueue({
      rows: [
        { project_id: 'p-1', task: 'Dev', total: 4.5 },
        { project_id: 'p-1', task: 'QA', total: '2' },
      ],
    });
    const result = await tasksRepo.sumHoursByProjects(['p-1', 'p-2'], undefined, exec);
    expect(exec.calls[0].params).toEqual([['p-1', 'p-2']]);
    expect(result).toEqual([
      { projectId: 'p-1', task: 'Dev', total: 4.5 },
      { projectId: 'p-1', task: 'QA', total: 2 },
    ]);
  });

  test('sumHoursByProjects with userId uses tasks-name join (preserved behavior)', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.sumHoursByProjects(['p-1'], 'u-1', exec);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('t.name = te.task');
    expect(sql).toContain('t.project_id = te.project_id');
    expect(sql).toContain('user_tasks');
    expect(exec.calls[0].params).toEqual([['p-1'], 'u-1']);
  });
});
