import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/reportsHoursRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const FROM = '2026-01-01';
const TO = '2026-01-31';

const enqueueEmptyN = (n: number) => {
  for (let i = 0; i < n; i++) exec.enqueue({ rows: [] });
};

describe('getTimesheetsSection', () => {
  test('without scoping: 7 queries with [fromDate, toDate, topLimit] for limited queries', async () => {
    enqueueEmptyN(7);
    await repo.getTimesheetsSection(
      { fromDate: FROM, toDate: TO, allowedTimesheetUserIds: null, topLimit: 10 },
      testDb,
    );
    expect(exec.calls).toHaveLength(7);
    // totals/byMonth/byLocation use baseWhere.params (2 elements)
    // top* queries append topLimit as $3
    const limited = exec.calls.filter((c) => /LIMIT \$\d+/.test(c.sql));
    for (const call of limited) {
      expect(call.params).toEqual([FROM, TO, 10]);
    }
  });

  test('with scoping: top* queries use $4 for LIMIT and pass [from, to, ids, limit]', async () => {
    enqueueEmptyN(7);
    await repo.getTimesheetsSection(
      {
        fromDate: FROM,
        toDate: TO,
        allowedTimesheetUserIds: ['u1', 'u2'],
        topLimit: 5,
      },
      testDb,
    );
    const limited = exec.calls.filter((c) => /LIMIT \$\d+/.test(c.sql));
    for (const call of limited) {
      expect(call.sql).toContain('LIMIT $4');
      expect(call.params).toEqual([FROM, TO, ['u1', 'u2'], 5]);
    }
  });

  test('totals row maps hours/cost/avgEntryHours', async () => {
    exec.enqueue({ rows: [{ hours: '40', entry_count: '4', total_cost: '400' }] });
    enqueueEmptyN(6);
    const result = await repo.getTimesheetsSection(
      { fromDate: FROM, toDate: TO, allowedTimesheetUserIds: null, topLimit: 10 },
      testDb,
    );
    expect(result.totals).toEqual({
      hours: 40,
      entryCount: 4,
      cost: 400,
      avgEntryHours: 10,
    });
  });

  test('avgEntryHours is 0 when no entries', async () => {
    exec.enqueue({ rows: [{ hours: '0', entry_count: '0', total_cost: '0' }] });
    enqueueEmptyN(6);
    const result = await repo.getTimesheetsSection(
      { fromDate: FROM, toDate: TO, allowedTimesheetUserIds: null, topLimit: 10 },
      testDb,
    );
    expect(result.totals.avgEntryHours).toBe(0);
  });
});

describe('getProjectsSection', () => {
  test('without timesheet scope: dispatches 3 queries (summary, items, hours)', async () => {
    enqueueEmptyN(3);
    await repo.getProjectsSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllProjects: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(3);
  });

  test('canViewTimesheets=false skips the hours query (only 2 queries)', async () => {
    enqueueEmptyN(2);
    await repo.getProjectsSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllProjects: true,
        canViewTimesheets: false,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(2);
  });

  test('summary computes activeCount = count - disabled, never negative', async () => {
    exec.enqueue({ rows: [{ count: '5', disabled_count: '2' }] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    const result = await repo.getProjectsSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllProjects: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(result).toMatchObject({ count: 5, activeCount: 3, disabledCount: 2 });
  });

  test('topByHours sorts DESC by hours and topByCost by cost (single-pass over rows)', async () => {
    exec.enqueue({ rows: [{ count: '0', disabled_count: '0' }] });
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        { label: 'A', hours: '10', cost: '100' },
        { label: 'B', hours: '20', cost: '50' },
        { label: 'C', hours: '5', cost: '200' },
      ],
    });
    const result = await repo.getProjectsSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllProjects: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(result.topByHours.map((r) => r.label)).toEqual(['B', 'A', 'C']);
    expect(result.topByCost.map((r) => r.label)).toEqual(['C', 'A', 'B']);
  });

  test('topLimit caps the result', async () => {
    exec.enqueue({ rows: [{ count: '0', disabled_count: '0' }] });
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: Array.from({ length: 10 }, (_, i) => ({
        label: `P${i}`,
        hours: String(i),
        cost: String(i * 10),
      })),
    });
    const result = await repo.getProjectsSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllProjects: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 3,
      },
      testDb,
    );
    expect(result.topByHours).toHaveLength(3);
    expect(result.topByCost).toHaveLength(3);
  });

  test('non-admin viewer joins user_projects and passes [viewerId, itemsLimit]', async () => {
    enqueueEmptyN(3);
    await repo.getProjectsSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllProjects: false,
        canViewTimesheets: false,
        canViewAllTimesheets: false,
        allowedTimesheetUserIds: ['u1'],
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('JOIN user_projects');
    expect(exec.calls[0].params).toEqual(['u1']);
    expect(exec.calls[1].params).toEqual(['u1', 50]);
  });
});

describe('getTasksSection', () => {
  test('canViewTimesheets=false skips hours query (2 queries only)', async () => {
    enqueueEmptyN(2);
    await repo.getTasksSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllTasks: true,
        canViewTimesheets: false,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(2);
  });

  test('full scope (all + all): hours query LIMIT $3 with [from, to, topLimit]', async () => {
    enqueueEmptyN(3);
    await repo.getTasksSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllTasks: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    const hoursCall = exec.calls.find((c) => c.sql.includes('te.task as label'));
    expect(hoursCall?.sql).toContain('LIMIT $3');
    expect(hoursCall?.params).toEqual([FROM, TO, 10]);
  });

  test('scoped (!all + !all): hours query has 5 params and LIMIT $5', async () => {
    enqueueEmptyN(3);
    await repo.getTasksSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllTasks: false,
        canViewTimesheets: true,
        canViewAllTimesheets: false,
        allowedTimesheetUserIds: ['u1'],
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    const hoursCall = exec.calls.find((c) => c.sql.includes('te.task as label'));
    expect(hoursCall?.sql).toContain('LIMIT $5');
    expect(hoursCall?.params).toEqual([FROM, TO, ['u1'], 'u1', 10]);
  });

  test('summary maps recurring_count', async () => {
    exec.enqueue({ rows: [{ count: '8', disabled_count: '1', recurring_count: '3' }] });
    enqueueEmptyN(2);
    const result = await repo.getTasksSection(
      {
        viewerId: 'u1',
        fromDate: FROM,
        toDate: TO,
        canViewAllTasks: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
        allowedTimesheetUserIds: null,
        itemsLimit: 50,
        topLimit: 10,
      },
      testDb,
    );
    expect(result).toMatchObject({
      count: 8,
      activeCount: 7,
      disabledCount: 1,
      recurringCount: 3,
    });
  });

  // The !canViewAllTasks branches funnel through `timeEntriesTasksJoin` (defined in tasksRepo).
  // These tests assert that BOTH branches of the JOIN's `OR` predicate ship in the emitted SQL,
  // so a future regression that drops one branch (e.g. only matching FK and losing legacy entries
  // whose `task_id` is NULL) would fail loudly here rather than at a customer reporting bug.
  //
  // The assertions extract the `JOIN tasks t ON ... (next-JOIN | WHERE)` substring and check
  // both branches sit inside it. Substring-presence elsewhere in the query (e.g. a future
  // CTE) wouldn't satisfy this — the whole `te.task_id IS NULL OR …` test has to live inside
  // the ON clause, otherwise legacy entries with NULL `task_id` get filtered out instead of
  // joined via the (project_id, name) fallback.
  describe('timeEntriesTasksJoin coverage in scoped task hours queries', () => {
    const extractTasksJoinOn = (sql: string): string => {
      // Match from `JOIN tasks t` (or `JOIN tasks "t"`) up to the next JOIN/WHERE/GROUP keyword.
      const match = sql.match(
        /JOIN\s+tasks\s+"?t"?\s+ON\s+([\s\S]*?)(?=\s+(?:JOIN|WHERE|GROUP)\b)/,
      );
      if (!match) throw new Error(`No 'JOIN tasks t ON ...' found in:\n${sql}`);
      return match[1];
    };

    test('matched-FK branch sits inside the JOIN ON clause', async () => {
      enqueueEmptyN(3);
      await repo.getTasksSection(
        {
          viewerId: 'u1',
          fromDate: FROM,
          toDate: TO,
          canViewAllTasks: false,
          canViewTimesheets: true,
          canViewAllTimesheets: true,
          allowedTimesheetUserIds: null,
          itemsLimit: 50,
          topLimit: 10,
        },
        testDb,
      );
      const hoursCall = exec.calls.find((c) => c.sql.includes('te.task as label'));
      expect(hoursCall).toBeDefined();
      const onClause = extractTasksJoinOn(hoursCall?.sql ?? '');
      expect(onClause).toContain('"t"."id" = "te"."task_id"');
    });

    test('name-fallback branch sits inside the JOIN ON clause, OR-combined with the FK branch', async () => {
      enqueueEmptyN(3);
      await repo.getTasksSection(
        {
          viewerId: 'u1',
          fromDate: FROM,
          toDate: TO,
          canViewAllTasks: false,
          canViewTimesheets: true,
          canViewAllTimesheets: false,
          allowedTimesheetUserIds: ['u1'],
          itemsLimit: 50,
          topLimit: 10,
        },
        testDb,
      );
      const hoursCall = exec.calls.find((c) => c.sql.includes('te.task as label'));
      expect(hoursCall).toBeDefined();
      const onClause = extractTasksJoinOn(hoursCall?.sql ?? '');
      // Both branches must be in the same ON clause; the fallback's three predicates AND'd
      // together inside parens, the whole thing OR'd against the FK match.
      expect(onClause).toContain('"t"."id" = "te"."task_id"');
      expect(onClause).toMatch(/\bOR\b/);
      expect(onClause).toContain('"te"."task_id" IS NULL');
      expect(onClause).toContain('"t"."project_id" = "te"."project_id"');
      expect(onClause).toContain('"t"."name" = "te"."task"');
    });
  });
});
