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
const resolveRecipientsMock = mock();
const createForUsersMock = mock();
const dispatchWebhookByIdMock = mock();
const runAtomicallyMock = mock(async (_exec: unknown, cb: (tx: unknown) => unknown) =>
  cb(TX_SENTINEL),
);

let evaluateProjectRulesOnce: typeof import('../../services/projectRulesEvaluator.ts').evaluateProjectRulesOnce;

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
  isEnabled: true,
  conditionMet: false,
  lastTriggeredAt: null,
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
  status: 'active' as const,
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

  ({ evaluateProjectRulesOnce } = await import('../../services/projectRulesEvaluator.ts'));
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
  resolveRecipientsMock.mockResolvedValue(['u1', 'u2']);
  createForUsersMock.mockResolvedValue(2);
  dispatchWebhookByIdMock.mockResolvedValue({ delivered: true, skipped: false, status: 204 });
});

describe('evaluateProjectRulesOnce', () => {
  test('creates notifications only on the rising edge', async () => {
    const now = new Date('2026-05-31T12:00:00');

    const result = await evaluateProjectRulesOnce({ now, exec: TX_SENTINEL as never });

    expect(result).toEqual({ evaluated: 1, triggered: 1, reset: 0, notified: 2 });
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-1', now, TX_SENTINEL);
    expect(resolveRecipientsMock).toHaveBeenCalledWith('p1', RULE.actionConfig, TX_SENTINEL);
    expect(createForUsersMock).toHaveBeenCalledWith(
      ['u1', 'u2'],
      expect.objectContaining({
        type: 'project_rule_triggered',
        data: {
          projectId: 'p1',
          projectName: 'Project',
          ruleId: 'pr-1',
          ruleName: 'Budget warning',
        },
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
    expect(markConditionNotMetMock).toHaveBeenCalledWith('pr-1', TX_SENTINEL);
    expect(markTriggeredMock).not.toHaveBeenCalled();
  });

  test('treats null metric values as not met', async () => {
    listMetricsMock.mockResolvedValue(new Map([['p1', { ...METRICS, budgetUsedPct: null }]]));

    await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(markConditionNotMetMock).toHaveBeenCalledWith('pr-1', TX_SENTINEL);
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
          { field: 'status', operator: 'eq', value: 'active', valueType: 'literal' },
        ],
      },
      {
        ...RULE,
        id: 'pr-or',
        conditionLogic: 'or',
        conditions: [
          { field: 'budget_used_pct', operator: 'gte', value: '95', valueType: 'literal' },
          { field: 'status', operator: 'eq', value: 'active', valueType: 'literal' },
        ],
      },
    ]);

    const result = await evaluateProjectRulesOnce({ exec: TX_SENTINEL as never });

    expect(result.triggered).toBe(2);
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-and', expect.any(Date), TX_SENTINEL);
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-or', expect.any(Date), TX_SENTINEL);
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
    expect(markTriggeredMock).toHaveBeenCalledWith('pr-1', expect.any(Date), TX_SENTINEL);
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
        metrics: expect.objectContaining({ budgetUsedPct: 90, status: 'active' }),
      }),
    );
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
