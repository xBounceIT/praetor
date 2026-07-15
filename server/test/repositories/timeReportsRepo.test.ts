import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/timeReportsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const definition = (patch: Partial<repo.TimeReportDefinition> = {}): repo.TimeReportDefinition => ({
  fromDate: '2026-07-01',
  toDate: '2026-07-31',
  clientId: null,
  projectIds: [],
  task: null,
  noteContains: '',
  fields: ['duration'],
  groupBy: [],
  totalsOnly: false,
  ...patch,
});

describe('timeReportsRepo', () => {
  test('combines inclusive dates, multi-project, legacy task, note and user scope filters', async () => {
    exec.enqueue({ rows: [] });

    await repo.listEntries(
      definition({
        clientId: 'c1',
        projectIds: ['p1', 'p2'],
        task: { projectId: 'p1', taskId: null, name: 'Legacy' },
        noteContains: '100% ready',
      }),
      ['u1', 'u2'],
      5_001,
      testDb,
    );

    expect(exec.calls).toHaveLength(1);
    const call = exec.calls[0];
    expect(call.sql).toContain('te.date >= $2');
    expect(call.sql).toContain('te.date <= $3');
    expect(call.sql).toContain('te.project_id = ANY');
    expect(call.sql).toContain('te.task_id IS NULL');
    expect(call.sql).toContain('ILIKE');
    expect(call.sql).toContain("ESCAPE '\\'");
    expect(call.params).toEqual([
      ['u1', 'u2'],
      '2026-07-01',
      '2026-07-31',
      'c1',
      ['p1', 'p2'],
      'p1',
      'Legacy',
      '%100\\% ready%',
      5_001,
      0,
    ]);
  });

  test('maps legacy entries and historical cost', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'e1',
          user_id: 'u1',
          user_name: 'Ada',
          date: '2026-07-10',
          client_id: 'c1',
          client_name: 'Acme',
          project_id: 'p1',
          project_name: 'Portal',
          task: 'Legacy',
          task_id: null,
          notes: '#233',
          duration: '4',
          hourly_cost: '37.125',
          is_placeholder: false,
          location: 'remote',
          created_at: '2026-07-10T10:00:00Z',
          version: 2,
        },
      ],
    });

    const rows = await repo.listEntries(definition(), ['u1'], 10, testDb);

    expect(rows[0]).toMatchObject({
      taskId: null,
      duration: 4,
      hourlyCost: 37.125,
      cost: 148.5,
      version: 2,
    });
  });

  test('returns complete aggregate totals independently from row limits', async () => {
    exec.enqueue({ rows: [{ count: '6000', duration: '125.5', cost: '333.335' }] });

    const totals = await repo.getTotals(definition(), ['u1'], testDb);

    expect(totals).toEqual({ count: 6000, duration: 125.5, cost: 333.34 });
  });

  test('deduplicates renamed persisted tasks by stable task identity', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });

    await repo.listOptions(['u1'], testDb);

    const taskQuery = exec.calls[3];
    expect(taskQuery.sql).toContain('SELECT DISTINCT ON');
    expect(taskQuery.sql).toContain("COALESCE(te.task_id, 'legacy:' || lower(te.task))");
    expect(taskQuery.sql).toContain('te.date DESC');
    expect(taskQuery.sql).toContain('te.created_at DESC NULLS LAST');
  });

  test('filters only candidate IDs when excluding administrators', async () => {
    exec.enqueue({ rows: [{ id: 'u1' }] });

    const ids = await repo.filterNonAdminUserIds(['u1', 'admin'], testDb);

    expect(ids).toEqual(['u1']);
    expect(exec.calls[0].sql).toContain('u.id = ANY');
    expect(exec.calls[0].params).toEqual([['u1', 'admin']]);
  });

  test('returns complete hierarchical subtotals with grouping sets', async () => {
    exec.enqueue({
      rows: [
        {
          group_key_0: 'c1',
          group_key_1: null,
          group_label_0: 'Acme',
          group_label_1: 'Portal',
          grouped_0: 0,
          grouped_1: 1,
          duration: '12.5',
          cost: '625.005',
        },
      ],
    });

    const rows = await repo.listSubtotals(
      definition({ groupBy: ['client', 'project'] }),
      ['u1'],
      5_001,
      testDb,
    );

    expect(rows).toEqual([
      { groupLevel: 0, groupKeys: ['c1'], label: 'Acme', duration: 12.5, cost: 625.01 },
    ]);
    expect(exec.calls[0].sql).toContain('GROUP BY GROUPING SETS');
    expect(exec.calls[0].sql).toContain('te.client_id');
  });
});
