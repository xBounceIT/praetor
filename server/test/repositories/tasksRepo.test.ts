import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as tasksRepo from '../../repositories/tasksRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';
import { extractTasksJoinOn } from '../helpers/sqlAssertions.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// `tasks` columns in schema declaration order:
// id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start,
// recurrence_end, recurrence_duration, expected_effort, revenue, notes, is_disabled, created_at
const TASK_BASE: readonly unknown[] = [
  't-1',
  'Build feature',
  'p-1',
  'desc',
  false,
  null,
  null,
  null,
  '0',
  '5',
  '120.5',
  'n',
  false,
  new Date('2026-04-30T12:00:00Z'),
];
const taskRow = (overrides: Record<number, unknown> = {}) => makeRow(TASK_BASE, overrides);

describe('listAll', () => {
  test('returns mapped rows with parsed numerics', async () => {
    exec.enqueue({ rows: [taskRow()] });
    const result = await tasksRepo.listAll(testDb);
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
    exec.enqueue({ rows: [taskRow({ 9: null, 10: null })] });
    const result = await tasksRepo.listAll(testDb);
    expect(result[0].expectedEffort).toBeUndefined();
    expect(result[0].revenue).toBeUndefined();
  });

  test('notes maps null to undefined', async () => {
    exec.enqueue({ rows: [taskRow({ 11: null })] });
    const result = await tasksRepo.listAll(testDb);
    expect(result[0].notes).toBeUndefined();
  });

  test('numeric values pass through as numbers when received as numbers', async () => {
    exec.enqueue({ rows: [taskRow({ 8: 1.5, 9: 8 })] });
    const result = await tasksRepo.listAll(testDb);
    expect(result[0].recurrenceDuration).toBe(1.5);
    expect(result[0].expectedEffort).toBe(8);
  });
});

describe('listForUser', () => {
  test('joins user_tasks and passes userId in params', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.listForUser('u-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('inner join "user_tasks"');
    expect(exec.calls[0].params).toContain('u-1');
  });
});

describe('create', () => {
  test('inserts and returns the mapped row', async () => {
    exec.enqueue({ rows: [taskRow()] });
    const created = await tasksRepo.create(
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
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "tasks"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('returning');
    expect(created.id).toBe('t-1');
    expect(created.createdAt).toBe(new Date('2026-04-30T12:00:00Z').getTime());
    expect(exec.calls[0].params).toContain('t-1');
    expect(exec.calls[0].params).toContain('Build');
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain('WEEKLY');
    expect(exec.calls[0].params).toContain('2026-04-30');
  });
});

describe('update', () => {
  test('only sets provided fields, id ends up in WHERE clause params', async () => {
    exec.enqueue({ rows: [taskRow()] });
    const result = await tasksRepo.update('t-1', { name: 'Renamed' }, testDb);
    expect(result?.id).toBe('t-1');
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "tasks"');
    expect(sql).toContain('set "name"');
    // Drizzle's UPDATE...RETURNING includes every column in RETURNING, so check only that
    // there's no SET assignment for fields we didn't patch.
    expect(sql).not.toContain('set "description"');
    expect(sql).not.toContain(', "description" =');
    expect(exec.calls[0].params).toContain('Renamed');
    expect(exec.calls[0].params).toContain('t-1');
  });

  test('omitting all fields falls back to SELECT', async () => {
    exec.enqueue({ rows: [taskRow()] });
    const result = await tasksRepo.update('t-1', {}, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).not.toContain('update');
    expect(sql).toContain('select');
    expect(result?.id).toBe('t-1');
  });

  test('explicit null clears nullable columns', async () => {
    exec.enqueue({ rows: [taskRow()] });
    await tasksRepo.update('t-1', { description: null, notes: null }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"description"');
    expect(sql).toContain('"notes"');
    // Two explicit nulls and the id are the only meaningful params.
    expect(exec.calls[0].params).toContain(null);
    expect(exec.calls[0].params).toContain('t-1');
  });

  test('returns null when UPDATE finds no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.update('t-x', { name: 'X' }, testDb)).toBeNull();
  });
});

describe('deleteById', () => {
  test('returns mapped object when row deleted', async () => {
    exec.enqueue({ rows: [['Build', 'p-1']] });
    const result = await tasksRepo.deleteById('t-1', testDb);
    expect(result).toEqual({ name: 'Build', projectId: 'p-1' });
  });

  test('returns null when nothing deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.deleteById('t-x', testDb)).toBeNull();
  });
});

describe('findAssignedUserIds', () => {
  test('maps user_id rows to a string array', async () => {
    exec.enqueue({ rows: [['u-1'], ['u-2']] });
    expect(await tasksRepo.findAssignedUserIds('t-1', testDb)).toEqual(['u-1', 'u-2']);
  });
});

describe('findNameAndProjectId', () => {
  test('returns mapped object when found', async () => {
    exec.enqueue({ rows: [['Build', 'p-1']] });
    expect(await tasksRepo.findNameAndProjectId('t-1', testDb)).toEqual({
      name: 'Build',
      projectId: 'p-1',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.findNameAndProjectId('t-x', testDb)).toBeNull();
  });
});

describe('clearUserAssignments / addUserAssignments', () => {
  test('clearUserAssignments deletes by taskId', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.clearUserAssignments('t-1', testDb);
    expect(exec.calls[0].params).toContain('t-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "user_tasks"');
  });

  test('addUserAssignments skips query when userIds is empty', async () => {
    await tasksRepo.addUserAssignments('t-1', [], testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('addUserAssignments uses ON CONFLICT DO NOTHING and includes all ids in params', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.addUserAssignments('t-1', ['u-1', 'u-2'], testDb);
    expect(exec.calls[0].params).toContain('t-1');
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].params).toContain('u-2');
    expect(exec.calls[0].sql.toLowerCase()).toContain('on conflict do nothing');
  });
});

describe('hours aggregation', () => {
  test('sumHoursByProjects (no user) passes ids and returns mapped rows with numeric totals', async () => {
    exec.enqueue({
      rows: [
        { projectId: 'p-1', task: 'Dev', total: 4.5 },
        { projectId: 'p-1', task: 'QA', total: '2' },
      ],
    });
    const result = await tasksRepo.sumHoursByProjects(['p-1', 'p-2'], undefined, testDb);
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain('p-2');
    expect(result).toEqual([
      { projectId: 'p-1', task: 'Dev', total: 4.5 },
      { projectId: 'p-1', task: 'QA', total: 2 },
    ]);
  });

  test('sumHoursByProjects short-circuits to [] for an empty ids array', async () => {
    const result = await tasksRepo.sumHoursByProjects([], undefined, testDb);
    expect(result).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  test('sumHoursByProjects with userId joins via tasks with name fallback', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.sumHoursByProjects(['p-1'], 'u-1', testDb);
    const sql = exec.calls[0].sql;
    // FROM clause declares the `te` alias; JOIN clause declares the `t` alias.
    expect(sql).toContain('FROM time_entries te');
    expect(sql).toContain('JOIN tasks t');
    expect(sql).toContain('JOIN user_tasks ut ON ut.task_id = "t"."id"');
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].params).toContain('p-1');

    // Both JOIN branches must sit inside the same `JOIN tasks t ON …` clause, OR-combined.
    // Asserting against the extracted ON clause (rather than the whole SQL) prevents a
    // regression that moves one branch into an unrelated CTE or WHERE filter from passing
    // silently — both predicates have to live in the same join condition. Helper is shared
    // with reportsHoursRepo.test.ts (test/helpers/sqlAssertions.ts).
    const onClause = extractTasksJoinOn(sql);
    expect(onClause).not.toBeNull();
    expect(onClause).toContain('"t"."id" = "te"."task_id"');
    expect(onClause).toMatch(/\bOR\b/);
    expect(onClause).toContain('"te"."task_id" IS NULL');
    expect(onClause).toContain('"t"."project_id" = "te"."project_id"');
    expect(onClause).toContain('"t"."name" = "te"."task"');
  });
});

describe('findIdByProjectAndName', () => {
  test('returns task id when found', async () => {
    exec.enqueue({ rows: [['t-1']] });
    const result = await tasksRepo.findIdByProjectAndName('p-1', 'Dev', testDb);
    expect(result).toBe('t-1');
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain('Dev');
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('limit');
    expect(sql).toContain('order by');
  });

  test('returns null when no matching task', async () => {
    exec.enqueue({ rows: [] });
    expect(await tasksRepo.findIdByProjectAndName('p-1', 'Missing', testDb)).toBeNull();
  });
});
