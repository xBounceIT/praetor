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
          status: 'terminato',
          endDate: '2026-06-05',
          manualRevenue: '1000',
          taskRevenue: '1200',
          costToDate: '300',
          hoursToDate: '12.5',
          billingType: 'mixed',
        },
        {
          projectId: 'p-manual-disabled',
          projectName: 'Manual disabled project',
          projectIsDisabled: false,
          clientIsDisabled: true,
          status: 'in_pausa',
          endDate: null,
          manualRevenue: null,
          taskRevenue: '0',
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

    expect(result.get('p-task')).toMatchObject({
      projectId: 'p-task',
      projectName: 'Task revenue project',
      revenue: 1200,
      costToDate: 300,
      budgetUsedPct: 25,
      hoursToDate: 12.5,
      daysUntilDeadline: 5,
      billingType: 'mixed',
      status: 'terminato',
    });
    expect(result.get('p-manual-disabled')).toMatchObject({
      projectId: 'p-manual-disabled',
      projectName: 'Manual disabled project',
      revenue: null,
      costToDate: 50,
      budgetUsedPct: null,
      hoursToDate: 2,
      daysUntilDeadline: null,
      billingType: 'retainer',
      status: 'in_pausa',
    });
  });

  test('uses manual revenue when task revenue is zero even if project has an order', async () => {
    exec.enqueue({
      rows: [
        {
          projectId: 'p-order',
          projectName: 'Order project',
          projectIsDisabled: false,
          clientIsDisabled: false,
          status: 'in_corso',
          endDate: null,
          manualRevenue: '500',
          taskRevenue: '0',
          costToDate: '200',
          hoursToDate: '1',
          billingType: 'time_and_materials',
        },
      ],
    });

    const result = await projectMetricsRepo.listForProjects(['p-order'], NOW, testDb);

    expect(result.get('p-order')?.revenue).toBe(500);
    expect(result.get('p-order')?.budgetUsedPct).toBe(40);
  });

  test('query derives current task metrics and preserves cost and billing semantics', async () => {
    exec.enqueue({ rows: [] });
    await projectMetricsRepo.listForProjects(['p1'], NOW, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from tasks');
    expect(sql).not.toContain('sale_items');
    expect(sql).toContain('coalesce(t.revenue, 0) * coalesce(t.duration, 1)');
    expect(sql).toContain(
      'round((coalesce(t.monthly_effort, 0) * coalesce(t.duration, 1))::numeric, 2)',
    );
    expect(sql).not.toContain('t.expected_effort');
    expect(sql).toContain('round((coalesce(te.duration');
    expect(sql).toContain("then 'mixed'");
    expect(sql).toContain('count(distinct bt2.billing_type)');
    expect(sql).toContain('p.status');
  });

  test('keeps legacy task entries separate from current task filters', async () => {
    exec.enqueue({ rows: [] });

    await projectMetricsRepo.listForProjects(['p1'], NOW, testDb, {
      timeZone: 'UTC',
      periodScope: {
        startDate: '2026-05-01',
        endDate: '2026-06-01',
        userIds: ['u1'],
        taskIds: ['t1'],
      },
    });

    const call = exec.calls[0];
    expect(call.sql).toContain('period_metrics');
    expect(call.sql).toContain('period_scope_validation');
    expect(call.sql).toContain('unnest');
    expect(call.sql).toContain('invalid_user_ids');
    expect(call.sql).toContain('invalid_task_ids');
    expect(call.sql).toContain('CROSS JOIN period_scope_validation');
    expect(call.sql).toContain('te.date >=');
    expect(call.sql).toContain('te.date <');
    expect(call.sql).toContain('te.user_id = ANY');
    expect(call.sql).not.toContain('LEFT JOIN LATERAL');
    expect(call.sql).not.toContain('resolved_task');
    expect(call.sql).toContain('OR te.task_id = ANY');
    expect(call.sql).toContain("'legacy:' || lower(te.task)");
    expect(call.params).toContainEqual(['u1']);
    expect(call.params).toContainEqual(['t1']);
  });

  test('derives calendar-day metrics in the periodic schedule time zone', async () => {
    exec.enqueue({
      rows: [
        {
          projectId: 'p1',
          projectName: 'Pacific project',
          clientId: 'c1',
          startDate: '2026-05-30',
          endDate: '2026-06-01',
          manualRevenue: null,
          taskRevenue: '0',
          billingType: 'retainer',
        },
      ],
    });

    const result = await projectMetricsRepo.listForProjects(
      ['p1'],
      new Date('2026-06-01T00:30:00Z'),
      testDb,
      {
        timeZone: 'America/Los_Angeles',
        periodScope: {
          startDate: '2026-05-01',
          endDate: '2026-06-01',
          userIds: [],
          taskIds: [],
        },
      },
    );

    expect(result.get('p1')).toMatchObject({
      daysUntilDeadline: 1,
      daysUntilStart: -1,
      daysSinceStart: 1,
    });
  });
});

describe('projectMetricsRepo.metricValueForField', () => {
  test('maps every mutable, computed, and periodic rule field', () => {
    const metrics: projectMetricsRepo.ProjectRuleMetrics = {
      projectId: 'p1',
      projectName: 'Project',
      clientId: 'c1',
      description: 'Description',
      isDisabled: false,
      createdAt: '2026-01-01',
      orderId: 'ord-1',
      offerId: 'off-1',
      offerRevisionCode: 'REV-2',
      startDate: '2026-02-01',
      endDate: '2026-12-31',
      revenue: 1_000,
      billingType: 'retainer',
      billingFrequency: 'monthly',
      status: 'in_corso',
      tipo: 'attivo',
      tipoConfirmed: true,
      costToDate: 400,
      budgetUsedPct: 40,
      hoursToDate: 80,
      daysUntilDeadline: 100,
      daysUntilStart: -10,
      daysSinceStart: 10,
      tasksCount: 8,
      enabledTasksCount: 6,
      plannedEffortHours: 120,
      monthlyEffortHours: 20,
      periodHours: 12,
      periodEntryCount: 7,
      periodActiveUsers: 3,
      periodActiveTasks: 2,
      periodCost: 90,
      invalidPeriodUserIds: [],
      invalidPeriodTaskIds: [],
    };
    const expected = {
      project_name: 'Project',
      description: 'Description',
      is_disabled: false,
      start_date: '2026-02-01',
      end_date: '2026-12-31',
      revenue: 1_000,
      billing_type: 'retainer',
      billing_frequency: 'monthly',
      status: 'in_corso',
      tipo: 'attivo',
      tipo_confirmed: true,
      cost_to_date: 400,
      budget_used_pct: 40,
      hours_to_date: 80,
      days_until_deadline: 100,
      days_until_start: -10,
      days_since_start: 10,
      tasks_count: 8,
      enabled_tasks_count: 6,
      planned_effort_hours: 120,
      monthly_effort_hours: 20,
      period_hours: 12,
      period_entry_count: 7,
      period_active_users: 3,
      period_active_tasks: 2,
      period_cost: 90,
    } as const;

    for (const [field, value] of Object.entries(expected)) {
      expect(projectMetricsRepo.metricValueForField(metrics, field)).toBe(value);
    }
  });
});
