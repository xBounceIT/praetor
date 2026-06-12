import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as projectMetricsRepo from '../../repositories/projectMetricsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const NOW = new Date('2026-05-31T12:00:00');

describe('projectMetricsRepo.listForProjects', () => {
  test('derives effective revenue, budget percent, effective billing type, and status', async () => {
    exec.enqueue({
      rows: [
        {
          projectId: 'p-task',
          projectName: 'Task revenue project',
          projectIsDisabled: false,
          clientIsDisabled: false,
          endDate: '2026-06-05',
          manualRevenue: '1000',
          orderId: 'co-1',
          taskRevenue: '1200',
          orderTotal: '900',
          costToDate: '300',
          hoursToDate: '12.5',
          billingType: 'mixed',
        },
        {
          projectId: 'p-manual-disabled',
          projectName: 'Manual disabled project',
          projectIsDisabled: false,
          clientIsDisabled: true,
          endDate: null,
          manualRevenue: null,
          orderId: null,
          taskRevenue: '0',
          orderTotal: null,
          costToDate: '50',
          hoursToDate: '2',
          billingType: 'retainer',
        },
      ],
    });

    const result = await projectMetricsRepo.listForProjects(
      ['p-task', 'p-manual-disabled'],
      NOW,
      testDb,
    );

    expect(result.get('p-task')).toEqual({
      projectId: 'p-task',
      projectName: 'Task revenue project',
      revenue: 1200,
      costToDate: 300,
      budgetUsedPct: 25,
      hoursToDate: 12.5,
      daysUntilDeadline: 5,
      billingType: 'mixed',
      status: 'active',
    });
    expect(result.get('p-manual-disabled')).toEqual({
      projectId: 'p-manual-disabled',
      projectName: 'Manual disabled project',
      revenue: null,
      costToDate: 50,
      budgetUsedPct: null,
      hoursToDate: 2,
      daysUntilDeadline: null,
      billingType: 'retainer',
      status: 'disabled',
    });
  });

  test('uses linked order total when task revenue is zero and project has an order', async () => {
    exec.enqueue({
      rows: [
        {
          projectId: 'p-order',
          projectName: 'Order project',
          projectIsDisabled: false,
          clientIsDisabled: false,
          endDate: null,
          manualRevenue: '500',
          orderId: 'co-1',
          taskRevenue: '0',
          orderTotal: '800',
          costToDate: '200',
          hoursToDate: '1',
          billingType: 'time_and_materials',
        },
      ],
    });

    const result = await projectMetricsRepo.listForProjects(['p-order'], NOW, testDb);

    expect(result.get('p-order')?.revenue).toBe(800);
    expect(result.get('p-order')?.budgetUsedPct).toBe(25);
  });

  test('query encodes the UI semantics for duration-scaled task revenue, linked order total, cost, and billing', async () => {
    exec.enqueue({ rows: [] });
    await projectMetricsRepo.listForProjects(['p1'], NOW, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from tasks');
    expect(sql).toContain('coalesce(t.revenue, 0) * coalesce(t.duration, 1)');
    expect(sql).toContain('sale_items');
    expect(sql).toContain('round((coalesce(te.duration');
    expect(sql).toContain("then 'mixed'");
    expect(sql).toContain('count(distinct bt2.billing_type)');
  });
});
