import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realProjectMetricsRepo from '../../repositories/projectMetricsRepo.ts';
import * as realRecipientsRepo from '../../repositories/projectRuleRecipientsRepo.ts';
import * as realProjectRulesRepo from '../../repositories/projectRulesRepo.ts';
import * as realWebhooksService from '../../services/webhooks.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';

const drizzleSnap = { ...realDrizzle };
const rulesRepoSnap = { ...realProjectRulesRepo };
const metricsRepoSnap = { ...realProjectMetricsRepo };
const recipientsRepoSnap = { ...realRecipientsRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const webhooksServiceSnap = { ...realWebhooksService };

const listEnabledMock = mock();
const listMetricsMock = mock();
const markConditionNotMetMock = mock();
const markTriggeredMock = mock();
const markPeriodicEvaluationMock = mock();
const resolveRecipientsMock = mock();
const createForUsersMock = mock();
const dispatchWebhookByIdMock = mock();
const runAtomicallyMock = mock(async (_exec: unknown, cb: (tx: unknown) => unknown) =>
  cb(TX_SENTINEL),
);

let evaluateProjectRulesOnce: typeof import('../../services/projectRulesEvaluator.ts').evaluateProjectRulesOnce;
let periodicMetricsConcurrency: number;
let evaluationConcurrency: number;
let webhookConcurrency: number;
const APP_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const RULE = {
  id: 'pr-1',
  projectId: 'p1',
  name: 'Budget warning',
  field: 'budget_used_pct',
  operator: 'gte',
  value: '80',
  conditionLogic: 'and' as const,
  conditions: [{ field: 'budget_used_pct', operator: 'gte', value: '80', valueType: 'literal' }],
  actionType: 'notify',
  actionConfig: {
    recipientUserIds: ['u1'],
    recipientRoleIds: ['manager'],
    webhookIds: [],
    actions: [
      { type: 'notify', recipientType: 'user', recipientUserIds: ['u1'] },
      { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
    ],
  },
  evaluationMode: 'continuous' as const,
  schedule: { frequency: 'monthly' as const, userIds: [], taskIds: [] },
  isEnabled: true,
  conditionMet: false,
  lastTriggeredAt: null,
  lastEvaluatedPeriod: null,
  configVersion: 7,
  createdBy: 'u-admin',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const METRICS = {
  projectId: 'p1',
  projectName: 'Project',
  revenue: 1000,
  costToDate: 900,
  budgetUsedPct: 90,
  hoursToDate: 10,
  daysUntilDeadline: 5,
  billingType: 'retainer' as const,
  status: 'in_corso' as const,
};

beforeAll(async () => {
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    db: TX_SENTINEL,
    runAtomically: runAtomicallyMock,
  }));
  mock.module('../../repositories/projectRulesRepo.ts', () => ({
    ...rulesRepoSnap,
    listEnabled: listEnabledMock,
    markConditionNotMet: markConditionNotMetMock,
    markTriggeredOnRisingEdge: markTriggeredMock,
    markPeriodicEvaluation: markPeriodicEvaluationMock,
  }));
  mock.module('../../repositories/projectMetricsRepo.ts', () => ({
    ...metricsRepoSnap,
    listForProjects: listMetricsMock,
    metricValueForField: metricsRepoSnap.metricValueForField,
  }));
  mock.module('../../repositories/projectRuleRecipientsRepo.ts', () => ({
    ...recipientsRepoSnap,
    resolveRecipientUserIds: resolveRecipientsMock,
  }));
  mock.module('../../repositories/notificationsRepo.ts', () => ({
    ...notificationsRepoSnap,
    createForUsers: createForUsersMock,
  }));
  mock.module('../../services/webhooks.ts', () => ({
    ...webhooksServiceSnap,
    dispatchWebhookById: dispatchWebhookByIdMock,
  }));

  ({
    evaluateProjectRulesOnce,
    PROJECT_RULE_PERIODIC_METRICS_CONCURRENCY: periodicMetricsConcurrency,
    PROJECT_RULE_EVALUATION_CONCURRENCY: evaluationConcurrency,
    PROJECT_RULE_WEBHOOK_CONCURRENCY: webhookConcurrency,
  } = await import('../../services/projectRulesEvaluator.ts'));
});

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/projectRulesRepo.ts', () => rulesRepoSnap);
  mock.module('../../repositories/projectMetricsRepo.ts', () => metricsRepoSnap);
  mock.module('../../repositories/projectRuleRecipientsRepo.ts', () => recipientsRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('../../services/webhooks.ts', () => webhooksServiceSnap);
});

beforeEach(() => {
  for (const fn of [
    listEnabledMock,
    listMetricsMock,
    markConditionNotMetMock,
    markTriggeredMock,
    markPeriodicEvaluationMock,
    resolveRecipientsMock,
    createForUsersMock,
    dispatchWebhookByIdMock,
    runAtomicallyMock,
  ]) {
    fn.mockReset();
  }
  runAtomicallyMock.mockImplementation(async (_exec, cb) => cb(TX_SENTINEL));
  listEnabledMock.mockResolvedValue([RULE]);
  listMetricsMock.mockResolvedValue(new Map([['p1', METRICS]]));
  markConditionNotMetMock.mockResolvedValue(false);
  markTriggeredMock.mockResolvedValue(true);
  markPeriodicEvaluationMock.mockResolvedValue(true);
  resolveRecipientsMock.mockResolvedValue(['u1', 'u2']);
  createForUsersMock.mockResolvedValue(2);
  dispatchWebhookByIdMock.mockResolvedValue({ delivered: true, skipped: false, status: 204 });
});

describe('evaluateProjectRulesOnce', () => {
  test('creates notifications only on the rising edge', async () => {
    const now = new Date('2026-05-31T12:00:00');

    const result = await evaluateProjectRulesOnce({ now, exec: TX_SENTINEL as never });

    expect(result).toEqual({ evaluated: 1, triggered: 1, reset: 0, notified: 2 });
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-1', now, 7, TX_SENTINEL);
    expect(resolveRecipientsMock).toHaveBeenCalledWith('p1', RULE.actionConfig, TX_SENTINEL);
    expect(createForUsersMock).toHaveBeenCalledWith(
      ['u1', 'u2'],
      expect.objectContaining({
        type: 'project_rule_triggered',
        data: expect.objectContaining({
          projectId: 'p1',
          projectName: 'Project',
          ruleId: 'pr-1',
          ruleName: 'Budget warning',
        }),
      }),
      TX_SENTINEL,
    );
  });

  test('does not duplicate notifications while condition is still met', async () => {
    markTriggeredMock.mockResolvedValue(false);

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result.triggered).toBe(0);
    expect(createForUsersMock).not.toHaveBeenCalled();
    expect(dispatchWebhookByIdMock).not.toHaveBeenCalled();
  });

  test('resets condition state when the condition becomes false', async () => {
    listMetricsMock.mockResolvedValue(new Map([['p1', { ...METRICS, budgetUsedPct: 25 }]]));
    markConditionNotMetMock.mockResolvedValue(true);

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result).toEqual({ evaluated: 1, triggered: 0, reset: 1, notified: 0 });
    expect(markConditionNotMetMock).toHaveBeenCalledWith('pr-1', 7, TX_SENTINEL);
    expect(markTriggeredMock).not.toHaveBeenCalled();
  });

  test('treats null metric values as not met', async () => {
    listMetricsMock.mockResolvedValue(new Map([['p1', { ...METRICS, budgetUsedPct: null }]]));

    await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(markConditionNotMetMock).toHaveBeenCalledWith('pr-1', 7, TX_SENTINEL);
    expect(createForUsersMock).not.toHaveBeenCalled();
  });

  test('supports AND and OR condition chains', async () => {
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        id: 'pr-and',
        conditionLogic: 'and',
        conditions: [
          { field: 'budget_used_pct', operator: 'gte', value: '80', valueType: 'literal' },
          { field: 'status', operator: 'eq', value: 'in_corso', valueType: 'literal' },
        ],
      },
      {
        ...RULE,
        id: 'pr-or',
        conditionLogic: 'or',
        conditions: [
          { field: 'budget_used_pct', operator: 'gte', value: '95', valueType: 'literal' },
          { field: 'status', operator: 'eq', value: 'in_corso', valueType: 'literal' },
        ],
      },
    ]);

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result.triggered).toBe(2);
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-and', expect.any(Date), 7, TX_SENTINEL);
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-or', expect.any(Date), 7, TX_SENTINEL);
  });

  test('supports comparing one field with another field', async () => {
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        field: 'revenue',
        operator: 'gt',
        value: 'cost_to_date',
        conditions: [
          { field: 'revenue', operator: 'gt', value: 'cost_to_date', valueType: 'field' },
        ],
      },
    ]);

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result.triggered).toBe(1);
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-1', expect.any(Date), 7, TX_SENTINEL);
  });

  test('runs a periodic rule on its custom monthly occurrence with user and task filters', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const periodicRule = {
      ...RULE,
      field: 'period_hours',
      operator: 'eq',
      value: '0',
      conditions: [
        { field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' as const },
      ],
      evaluationMode: 'periodic' as const,
      schedule: {
        frequency: 'monthly:third:1' as const,
        userIds: ['u1'],
        taskIds: ['t1'],
      },
    };
    listEnabledMock.mockResolvedValue([periodicRule]);
    listMetricsMock.mockImplementation(
      async (projectIds: string[], _now: Date, _exec: unknown, _scope?: unknown) =>
        projectIds.length === 0 ? new Map() : new Map([['p1', { ...METRICS, periodHours: 0 }]]),
    );

    const result = await evaluateProjectRulesOnce({ now, exec: TX_SENTINEL as never });

    expect(result).toEqual({ evaluated: 1, triggered: 1, reset: 0, notified: 2 });
    expect(listMetricsMock).toHaveBeenCalledWith(['p1'], now, TX_SENTINEL, {
      startDate: '2026-05-01',
      endDate: '2026-06-01',
      timeZone: APP_TIME_ZONE,
      userIds: ['u1'],
      taskIds: ['t1'],
    });
    expect(markPeriodicEvaluationMock).toHaveBeenCalledWith(
      'pr-1',
      `monthly:${APP_TIME_ZONE}:2026-05-01:2026-06-01`,
      true,
      now,
      7,
      TX_SENTINEL,
    );
  });

  test('skips an already evaluated periodic period', async () => {
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        evaluationMode: 'periodic',
        lastEvaluatedPeriod: `monthly:${APP_TIME_ZONE}:2026-05-01:2026-06-01`,
      },
    ]);

    const result = await evaluateProjectRulesOnce({
      now: new Date('2026-06-01T08:00:00Z'),
      exec: TX_SENTINEL as never,
    });

    expect(result).toEqual({ evaluated: 0, triggered: 0, reset: 0, notified: 0 });
    expect(markPeriodicEvaluationMock).not.toHaveBeenCalled();
  });

  test('catches up the next missed period after scheduler downtime', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        field: 'period_hours',
        operator: 'eq',
        value: '0',
        conditions: [{ field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' }],
        evaluationMode: 'periodic',
        lastEvaluatedPeriod: `monthly:${APP_TIME_ZONE}:2026-02-01:2026-03-01`,
      },
    ]);
    listMetricsMock.mockImplementation(async (projectIds: string[]) =>
      projectIds.length === 0 ? new Map() : new Map([['p1', { ...METRICS, periodHours: 0 }]]),
    );

    await evaluateProjectRulesOnce({ now, exec: TX_SENTINEL as never });

    expect(listMetricsMock).toHaveBeenCalledWith(['p1'], now, TX_SENTINEL, {
      startDate: '2026-03-01',
      endDate: '2026-04-01',
      timeZone: APP_TIME_ZONE,
      userIds: [],
      taskIds: [],
    });
    expect(markPeriodicEvaluationMock).toHaveBeenCalledWith(
      'pr-1',
      `monthly:${APP_TIME_ZONE}:2026-03-01:2026-04-01`,
      true,
      now,
      7,
      TX_SENTINEL,
    );
  });

  test('limits periodic metric query concurrency', async () => {
    let activeQueries = 0;
    let maxActiveQueries = 0;
    const rules = Array.from({ length: periodicMetricsConcurrency + 3 }, (_, index) => ({
      ...RULE,
      id: `pr-${index}`,
      projectId: `p${index}`,
      field: 'period_hours',
      operator: 'eq',
      value: '0',
      conditions: [{ field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' }],
      evaluationMode: 'periodic',
    }));
    listEnabledMock.mockResolvedValue(rules);
    listMetricsMock.mockImplementation(async (projectIds: string[]) => {
      if (projectIds.length === 0) return new Map();
      activeQueries += 1;
      maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
      await new Promise((resolve) => setImmediate(resolve));
      activeQueries -= 1;
      const projectId = projectIds[0];
      return new Map([[projectId, { ...METRICS, projectId, periodHours: 0 }]]);
    });

    const result = await evaluateProjectRulesOnce({
      now: new Date('2026-06-15T08:00:00Z'),
      exec: TX_SENTINEL as never,
    });

    expect(result.triggered).toBe(rules.length);
    expect(maxActiveQueries).toBeLessThanOrEqual(periodicMetricsConcurrency);
    expect(maxActiveQueries).toBeGreaterThan(1);
  });

  test('limits concurrent rule transactions after metrics are loaded', async () => {
    let activeTransactions = 0;
    let maxActiveTransactions = 0;
    const rules = Array.from({ length: evaluationConcurrency + 3 }, (_, index) => ({
      ...RULE,
      id: `pr-${index}`,
    }));
    listEnabledMock.mockResolvedValue(rules);
    runAtomicallyMock.mockImplementation(async (_exec, cb) => {
      activeTransactions += 1;
      maxActiveTransactions = Math.max(maxActiveTransactions, activeTransactions);
      await new Promise((resolve) => setImmediate(resolve));
      try {
        return await cb(TX_SENTINEL);
      } finally {
        activeTransactions -= 1;
      }
    });

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result.triggered).toBe(rules.length);
    expect(maxActiveTransactions).toBeLessThanOrEqual(evaluationConcurrency);
    expect(maxActiveTransactions).toBeGreaterThan(1);
  });

  test('reuses periodic metrics for rules with the same normalized scope', async () => {
    const periodicRule = {
      ...RULE,
      field: 'period_hours',
      operator: 'eq',
      value: '0',
      conditions: [{ field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' }],
      evaluationMode: 'periodic',
      schedule: {
        frequency: 'monthly',
        userIds: ['u2', 'u1'],
        taskIds: ['t2', 't1'],
      },
    };
    listEnabledMock.mockResolvedValue([
      periodicRule,
      {
        ...periodicRule,
        id: 'pr-2',
        schedule: {
          ...periodicRule.schedule,
          userIds: ['u1', 'u2'],
          taskIds: ['t1', 't2'],
        },
      },
    ]);
    listMetricsMock.mockImplementation(async (projectIds: string[]) =>
      projectIds.length === 0 ? new Map() : new Map([['p1', { ...METRICS, periodHours: 0 }]]),
    );

    const result = await evaluateProjectRulesOnce({
      now: new Date('2026-06-15T08:00:00Z'),
      exec: TX_SENTINEL as never,
    });

    expect(result.triggered).toBe(2);
    expect(listMetricsMock).toHaveBeenCalledTimes(2);
  });

  test('isolates a periodic metric query failure to its rule', async () => {
    const logger = { error: mock(), warn: mock() };
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        id: 'pr-failed',
        projectId: 'p-failed',
        field: 'period_hours',
        conditions: [{ field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' }],
        evaluationMode: 'periodic',
      },
      {
        ...RULE,
        id: 'pr-healthy',
        projectId: 'p-healthy',
        field: 'period_hours',
        conditions: [{ field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' }],
        evaluationMode: 'periodic',
      },
    ]);
    listMetricsMock.mockImplementation(async (projectIds: string[]) => {
      if (projectIds.length === 0) return new Map();
      if (projectIds[0] === 'p-failed') throw new Error('metrics unavailable');
      return new Map([['p-healthy', { ...METRICS, projectId: 'p-healthy', periodHours: 0 }]]);
    });

    const result = await evaluateProjectRulesOnce({
      now: new Date('2026-06-15T08:00:00Z'),
      logger,
      exec: TX_SENTINEL as never,
    });

    expect(result.triggered).toBe(1);
    expect(markPeriodicEvaluationMock).toHaveBeenCalledTimes(1);
    expect(markPeriodicEvaluationMock.mock.calls[0][0]).toBe('pr-healthy');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: 'pr-failed',
        err: expect.objectContaining({ message: 'metrics unavailable' }),
      }),
      'Project rule evaluation failed',
    );
  });

  test('skips a periodic rule whose user or task filter was deleted', async () => {
    const logger = { error: mock(), warn: mock() };
    const periodicRule = {
      ...RULE,
      field: 'period_hours',
      operator: 'eq',
      value: '0',
      conditions: [{ field: 'period_hours', operator: 'eq', value: '0', valueType: 'literal' }],
      evaluationMode: 'periodic' as const,
      schedule: {
        frequency: 'monthly' as const,
        userIds: ['deleted-user'],
        taskIds: ['deleted-task'],
      },
    };
    listEnabledMock.mockResolvedValue([periodicRule]);
    listMetricsMock.mockImplementation(async (projectIds: string[]) =>
      projectIds.length === 0
        ? new Map()
        : new Map([
            [
              'p1',
              {
                ...METRICS,
                periodHours: 0,
                invalidPeriodUserIds: ['deleted-user'],
                invalidPeriodTaskIds: ['deleted-task'],
              },
            ],
          ]),
    );

    const result = await evaluateProjectRulesOnce({
      now: new Date('2026-06-15T08:00:00Z'),
      logger,
      exec: TX_SENTINEL as never,
    });

    expect(result).toEqual({ evaluated: 0, triggered: 0, reset: 0, notified: 0 });
    expect(listMetricsMock).toHaveBeenCalledTimes(2);
    expect(markPeriodicEvaluationMock).not.toHaveBeenCalled();
    expect(createForUsersMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        ruleId: 'pr-1',
        projectId: 'p1',
        invalidScheduleFilters: {
          userIds: ['deleted-user'],
          taskIds: ['deleted-task'],
        },
      },
      'Project rule skipped because schedule filters are no longer valid',
    );
  });

  test('dispatches configured webhooks after the rising edge commit', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        actionConfig: {
          recipientUserIds: ['u1'],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [
            { type: 'notify', recipientType: 'user', recipientUserIds: ['u1'] },
            { type: 'webhook', webhookId: 'webhook-1' },
          ],
        },
      },
    ]);

    const result = await evaluateProjectRulesOnce({ now, exec: TX_SENTINEL as never });

    expect(result).toEqual({ evaluated: 1, triggered: 1, reset: 0, notified: 2 });
    expect(dispatchWebhookByIdMock).toHaveBeenCalledWith(
      'webhook-1',
      expect.objectContaining({
        eventType: 'project_rule_triggered',
        triggeredAt: '2026-05-31T12:00:00.000Z',
        project: { id: 'p1', name: 'Project' },
        rule: expect.objectContaining({ id: 'pr-1', name: 'Budget warning' }),
        metrics: expect.objectContaining({
          costToDate: 900,
          budgetUsedPct: 90,
          status: 'in_corso',
        }),
      }),
    );
  });

  test('limits concurrent webhook deliveries for a rule', async () => {
    let activeDeliveries = 0;
    let maxActiveDeliveries = 0;
    const webhookIds = Array.from(
      { length: webhookConcurrency + 3 },
      (_, index) => `webhook-${index}`,
    );
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds,
          actions: webhookIds.map((webhookId) => ({ type: 'webhook', webhookId })),
        },
      },
    ]);
    dispatchWebhookByIdMock.mockImplementation(async () => {
      activeDeliveries += 1;
      maxActiveDeliveries = Math.max(maxActiveDeliveries, activeDeliveries);
      await new Promise((resolve) => setImmediate(resolve));
      activeDeliveries -= 1;
      return { delivered: true, skipped: false, status: 204 };
    });

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result.triggered).toBe(1);
    expect(dispatchWebhookByIdMock).toHaveBeenCalledTimes(webhookIds.length);
    expect(maxActiveDeliveries).toBeLessThanOrEqual(webhookConcurrency);
    expect(maxActiveDeliveries).toBeGreaterThan(1);
  });

  test('omits cost metrics from non-cost rule webhook payloads', async () => {
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        field: 'revenue',
        operator: 'gte',
        value: '1000',
        conditionLogic: 'or',
        conditions: [
          { field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' },
          {
            field: 'is_disabled',
            operator: 'is_false',
            value: 'cost_to_date',
            valueType: 'field',
          },
        ],
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      },
    ]);

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });
    const payload = dispatchWebhookByIdMock.mock.calls[0][1] as {
      metrics: Record<string, unknown>;
    };

    expect(result).toEqual({ evaluated: 1, triggered: 1, reset: 0, notified: 0 });
    expect(payload.metrics).toEqual(
      expect.objectContaining({ revenue: 1000, hoursToDate: 10, status: 'in_corso' }),
    );
    expect(Object.keys(payload.metrics)).not.toContain('costToDate');
    expect(Object.keys(payload.metrics)).not.toContain('budgetUsedPct');
  });

  test('logs webhook dispatch failures without failing the rule evaluation', async () => {
    const warn = mock();
    dispatchWebhookByIdMock.mockRejectedValue(new Error('remote down'));
    listEnabledMock.mockResolvedValue([
      {
        ...RULE,
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      },
    ]);

    const result = await evaluateProjectRulesOnce({
      exec: TX_SENTINEL as never,
      logger: { error: mock(), warn },
    });

    expect(result).toEqual({ evaluated: 1, triggered: 1, reset: 0, notified: 0 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: 'webhook-1',
        err: expect.objectContaining({ message: 'remote down' }),
      }),
      'Project rule webhook dispatch failed',
    );
  });
});
