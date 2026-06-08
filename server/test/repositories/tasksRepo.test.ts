import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as tasksRepo from '../../repositories/tasksRepo.ts';
import * as userAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';
import { extractTasksJoinOn } from '../helpers/sqlAssertions.ts';

const { MANUAL_ASSIGNMENT_SOURCE, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE } = userAssignmentsRepo;

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// `tasks` columns in schema declaration order:
// id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start,
// recurrence_end, recurrence_duration, expected_effort, revenue, notes, is_disabled, created_at,
// billing_type, billing_frequency, monthly_effort
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
  'retainer',
  'one_time',
  '2',
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
      monthlyEffort: 2,
      revenue: 120.5,
      isDisabled: false,
      billingType: 'retainer',
      billingFrequency: 'one_time',
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

describe('listRecurringForUser', () => {
  test('filters by user_id, is_recurring = true, and is_disabled = false', async () => {
    exec.enqueue({ rows: [taskRow({ 4: true })] });
    const result = await tasksRepo.listRecurringForUser('u-1', testDb);
    expect(result).toHaveLength(1);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('inner join "user_tasks"');
    expect(sql).toContain('is_recurring');
    expect(sql).toContain('is_disabled');
    // user_id is one of the params.
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
        monthlyEffort: 2,
        revenue: 100,
        notes: null,
        isDisabled: false,
        billingType: 'retainer',
        billingFrequency: 'one_time',
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
    expect(exec.calls[0].params).toContain('retainer');
    expect(exec.calls[0].params).toContain('one_time');
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

  // Billing frequency is independent of billing type now: a misura (time_and_materials) task
  // may bill one-time. The update writes the requested frequency directly - no read-back of
  // the current billing type, no FOR UPDATE lock, no forcing to monthly.
  test('billingFrequency-only update persists the requested frequency for any billing type', async () => {
    exec.enqueue({ rows: [taskRow({ 14: 'time_and_materials', 15: 'one_time' })] });

    await tasksRepo.update('t-1', { billingFrequency: 'one_time' }, testDb);

    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "tasks"');
    expect(exec.calls[0].params).toContain('one_time');
    expect(exec.calls[0].params).not.toContain('monthly');
  });

  test('billingType-only update leaves billing_frequency untouched', async () => {
    exec.enqueue({ rows: [taskRow({ 14: 'time_and_materials', 15: 'one_time' })] });

    await tasksRepo.update('t-1', { billingType: 'time_and_materials' }, testDb);

    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('set "billing_type"');
    expect(sql).not.toContain('"billing_frequency" =');
    expect(exec.calls[0].params).toContain('time_and_materials');
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

describe('clearNonTopManagerAssignments / addManualAssignments', () => {
  test('clearNonTopManagerAssignments preserves top_manager_auto rows', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.clearNonTopManagerAssignments('t-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from user_tasks');
    expect(exec.calls[0].sql).toContain('assignment_source !=');
    expect(exec.calls[0].params).toContain('t-1');
    expect(exec.calls[0].params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
  });

  test('addManualAssignments skips query when userIds is empty', async () => {
    await tasksRepo.addManualAssignments('t-1', [], testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('addManualAssignments uses MANUAL source and ON CONFLICT DO NOTHING with batch', async () => {
    exec.enqueue({ rows: [] });
    await tasksRepo.addManualAssignments('t-1', ['u-1', 'u-2'], testDb);
    expect(exec.calls[0].params).toContainEqual(['u-1', 'u-2']);
    expect(exec.calls[0].params).toContain('t-1');
    expect(exec.calls[0].params).toContain(MANUAL_ASSIGNMENT_SOURCE);
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
    // FROM clause declares the `te` alias; LATERAL subquery declares the `t` alias.
    expect(sql).toContain('FROM time_entries te');
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('JOIN user_tasks ut ON ut.task_id = "t"."id"');
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].params).toContain('p-1');

    // Both JOIN branches must sit inside the LATERAL subquery's WHERE clause, OR-combined.
    // Asserting against the extracted body (rather than the whole SQL) prevents a regression
    // that moves one branch into an unrelated CTE or outer WHERE filter from passing silently.
    // Helper is shared with reportsHoursRepo.test.ts (test/helpers/sqlAssertions.ts).
    const onClause = extractTasksJoinOn(sql);
    expect(onClause).not.toBeNull();
    expect(onClause).toContain('t_inner.id = "te"."task_id"');
    expect(onClause).toMatch(/\bOR\b/);
    expect(onClause).toContain('"te"."task_id" IS NULL');
    expect(onClause).toContain('t_inner.project_id = "te"."project_id"');
    expect(onClause).toContain('t_inner.name = "te"."task"');
  });

  // When two tasks share (project_id, name), the legacy OR-branch
  // `ON t.id = te.task_id OR (te.task_id IS NULL AND ...)` multiplied rows because a single
  // time-entry with task_id IS NULL matched every duplicate. The LATERAL `SELECT ... LIMIT 1`
  // enforces one task row per time entry. We can't simulate true row multiplication against
  // the fake DB (it returns whatever we enqueue), but we CAN assert the structural guarantee
  // that prevents it: a LATERAL subquery with LIMIT 1, ordering FK matches first then by
  // lowest task id (matching findIdByProjectAndName's contract).
  test('legacy fallback resolves duplicate task names to a single row (no multiplication)', async () => {
    exec.enqueue({ rows: [{ projectId: 'p-1', task: 'Dev', total: 4 }] });
    const result = await tasksRepo.sumHoursByProjects(['p-1'], 'u-1', testDb);
    const sql = exec.calls[0].sql;

    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toMatch(/LIMIT\s+1/);
    expect(sql).toMatch(/ORDER BY[\s\S]*t_inner\.id/);
    expect(result).toEqual([{ projectId: 'p-1', task: 'Dev', total: 4 }]);
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
