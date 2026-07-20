import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProjectRuleRecipientsRepo from '../../repositories/projectRuleRecipientsRepo.ts';
import * as realProjectRulesRepo from '../../repositories/projectRulesRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const projectRulesRepoSnap = { ...realProjectRulesRepo };
const recipientsRepoSnap = { ...realProjectRuleRecipientsRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const listRulesMock = mock();
const createRuleMock = mock();
const updateRuleMock = mock();
const findRuleMock = mock();
const deleteRuleMock = mock();
const listRecipientOptionsMock = mock();
const findInvalidRecipientIdsMock = mock();
const findProjectNameMock = mock();
const isProjectAssignedToUserMock = mock();
const logAuditMock = mock(async () => undefined);
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

let routePlugin: FastifyPluginAsync;
let app: FastifyInstance;
let currentPermissions: string[];

const USER = {
  id: 'u1',
  name: 'Manager',
  username: 'manager',
  role: 'manager',
  avatarInitials: 'MG',
  isDisabled: false,
  sessionVersion: 1,
  tokenVersion: 1,
};

const authHeaders = () => ({ authorization: `Bearer ${signToken({ userId: USER.id })}` });

const SAMPLE_RULE = {
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
    recipientUserIds: ['u2'],
    recipientRoleIds: ['manager'],
    webhookIds: [],
    actions: [
      { type: 'notify', recipientType: 'user', recipientUserIds: ['u2'] },
      { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
    ],
  },
  isEnabled: true,
  conditionMet: false,
  lastTriggeredAt: null,
  createdBy: 'u1',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/projectRulesRepo.ts', () => ({
    ...projectRulesRepoSnap,
    listByProject: listRulesMock,
    create: createRuleMock,
    update: updateRuleMock,
    findByProjectAndId: findRuleMock,
    deleteByProjectAndId: deleteRuleMock,
    normalizeProjectRuleActionConfig: projectRulesRepoSnap.normalizeProjectRuleActionConfig,
  }));
  mock.module('../../repositories/projectRuleRecipientsRepo.ts', () => ({
    ...recipientsRepoSnap,
    listRecipientOptions: listRecipientOptionsMock,
    findInvalidRecipientIds: findInvalidRecipientIdsMock,
  }));
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    findClientIdAndName: findProjectNameMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    isProjectAssignedToUser: isProjectAssignedToUserMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/project-rules.ts')).default;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/projectRulesRepo.ts', () => projectRulesRepoSnap);
  mock.module('../../repositories/projectRuleRecipientsRepo.ts', () => recipientsRepoSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

beforeEach(async () => {
  for (const fn of [
    findAuthUserByIdMock,
    userHasRoleMock,
    getRolePermissionsMock,
    listRulesMock,
    createRuleMock,
    updateRuleMock,
    findRuleMock,
    deleteRuleMock,
    listRecipientOptionsMock,
    findInvalidRecipientIdsMock,
    findProjectNameMock,
    isProjectAssignedToUserMock,
    logAuditMock,
    withDbTransactionMock,
  ]) {
    fn.mockReset();
  }
  resetWithDbTransactionMock();
  currentPermissions = ['projects.rules.view'];
  findAuthUserByIdMock.mockResolvedValue(USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockImplementation(async () => currentPermissions);
  isProjectAssignedToUserMock.mockResolvedValue(true);
  findInvalidRecipientIdsMock.mockResolvedValue({ userIds: [], roleIds: [], webhookIds: [] });
  findProjectNameMock.mockResolvedValue({ clientId: 'c1', name: 'Project' });
  app = await buildRouteTestApp(routePlugin, '/api/projects');
});

afterEach(async () => {
  await app.close();
});

describe('project rule routes', () => {
  test('403 without projects.rules.view', async () => {
    currentPermissions = [];

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(listRulesMock).not.toHaveBeenCalled();
  });

  test('403 when the user lacks project assignment and manage_all.view', async () => {
    currentPermissions = ['projects.rules.view'];
    isProjectAssignedToUserMock.mockResolvedValue(false);

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(listRulesMock).not.toHaveBeenCalled();
  });

  test('GET rules redacts webhook identifiers without administration.webhooks.view', async () => {
    currentPermissions = ['projects.rules.view'];
    listRulesMock.mockResolvedValue([
      {
        ...SAMPLE_RULE,
        actionConfig: {
          ...SAMPLE_RULE.actionConfig,
          webhookIds: ['webhook-1'],
          actions: [
            ...SAMPLE_RULE.actionConfig.actions,
            { type: 'webhook', webhookId: 'webhook-1' },
          ],
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const [redactedRule] = JSON.parse(res.body);
    expect(redactedRule.actionType).toBe('webhook');
    expect(redactedRule.actionConfig).toEqual({
      ...SAMPLE_RULE.actionConfig,
      webhookIds: [],
      actions: SAMPLE_RULE.actionConfig.actions,
    });
  });

  test('GET rules retains webhook identifiers for authorized callers', async () => {
    currentPermissions = ['projects.rules.view', 'administration.webhooks.view'];
    const rule = {
      ...SAMPLE_RULE,
      actionConfig: {
        ...SAMPLE_RULE.actionConfig,
        webhookIds: ['webhook-1'],
        actions: [...SAMPLE_RULE.actionConfig.actions, { type: 'webhook', webhookId: 'webhook-1' }],
      },
    };
    listRulesMock.mockResolvedValue([rule]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0].actionConfig).toEqual(rule.actionConfig);
  });

  test('GET rules marks a redacted legacy webhook-only config as webhook', async () => {
    currentPermissions = ['projects.rules.view'];
    listRulesMock.mockResolvedValue([
      {
        ...SAMPLE_RULE,
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0]).toEqual(
      expect.objectContaining({
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [],
        },
      }),
    );
  });

  test('GET recipients returns webhook options to authorized callers', async () => {
    currentPermissions = ['projects.rules.view', 'administration.webhooks.view'];
    listRecipientOptionsMock.mockResolvedValue({
      users: [{ id: 'u2', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
      roles: [{ id: 'manager', name: 'Manager' }],
      webhooks: [{ id: 'webhook-1', name: 'Slack' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules/recipients',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).users[0].id).toBe('u2');
    expect(JSON.parse(res.body).webhooks[0].id).toBe('webhook-1');
    expect(listRecipientOptionsMock).toHaveBeenCalledWith('p1');
  });

  test('GET recipients hides webhook options without administration.webhooks.view', async () => {
    currentPermissions = ['projects.rules.view'];
    listRecipientOptionsMock.mockResolvedValue({
      users: [{ id: 'u2', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
      roles: [{ id: 'manager', name: 'Manager' }],
      webhooks: [{ id: 'webhook-1', name: 'Slack' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/rules/recipients',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).webhooks).toEqual([]);
  });

  test('POST rejects cost-derived fields without reports.cost.view', async () => {
    currentPermissions = ['projects.rules.create'];

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Budget',
        field: 'budget_used_pct',
        operator: 'gte',
        value: '80',
        actionConfig: { recipientUserIds: [], recipientRoleIds: ['manager'] },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('requires reports.cost.view');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('POST rejects cost-derived target fields without reports.cost.view', async () => {
    currentPermissions = ['projects.rules.create'];

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Revenue vs cost',
        conditions: [
          { field: 'revenue', operator: 'gt', value: 'cost_to_date', valueType: 'field' },
        ],
        actionConfig: { recipientUserIds: ['u2'], recipientRoleIds: [] },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('cost_to_date requires reports.cost.view');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('POST creates a rule and writes an audit log', async () => {
    currentPermissions = ['projects.rules.create'];
    const createdRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      operator: 'gte',
      value: '1000',
      conditions: [
        { field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' },
        { field: 'revenue', operator: 'gt', value: 'hours_to_date', valueType: 'field' },
      ],
      actionConfig: {
        recipientUserIds: ['u2'],
        recipientRoleIds: [],
        webhookIds: [],
        actions: [{ type: 'notify', recipientType: 'user', recipientUserIds: ['u2'] }],
      },
    };
    createRuleMock.mockResolvedValue(createdRule);

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Revenue',
        conditionLogic: 'and',
        conditions: [
          { field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' },
          { field: 'revenue', operator: 'gt', value: 'hours_to_date', valueType: 'field' },
        ],
        actionConfig: { recipientUserIds: ['u2'], recipientRoleIds: [] },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual(createdRule);
    expect(createRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^pr-/),
        projectId: 'p1',
        createdBy: USER.id,
        name: 'Revenue',
        conditionLogic: 'and',
        conditions: [
          { field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' },
          { field: 'revenue', operator: 'gt', value: 'hours_to_date', valueType: 'field' },
        ],
        actionType: 'notify',
      }),
      TX_SENTINEL,
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_rule.created', entityType: 'project_rule' }),
    );
  });

  test('POST creates a rule with notification and webhook actions', async () => {
    currentPermissions = ['projects.rules.create', 'administration.webhooks.view'];
    const createdRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      operator: 'gte',
      value: '1000',
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: ['manager'],
        webhookIds: ['webhook-1'],
        actions: [
          { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
          { type: 'webhook', webhookId: 'webhook-1' },
        ],
      },
    };
    createRuleMock.mockResolvedValue(createdRule);

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Revenue',
        conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
        actionConfig: {
          actions: [
            { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
            { type: 'webhook', webhookId: 'webhook-1' },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'notify',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: ['manager'],
          webhookIds: ['webhook-1'],
          actions: [
            { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
            { type: 'webhook', webhookId: 'webhook-1' },
          ],
        },
      }),
      TX_SENTINEL,
    );
  });

  test('POST rejects webhook actions without administration.webhooks.view', async () => {
    currentPermissions = ['projects.rules.create'];
    createRuleMock.mockResolvedValue({
      ...SAMPLE_RULE,
      actionType: 'webhook',
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-1'],
        actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Webhook',
        field: 'revenue',
        operator: 'gte',
        value: '1000',
        actionConfig: {
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('actionConfig contains invalid recipients or webhooks');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('POST rejects unsupported fields and operators', async () => {
    currentPermissions = ['projects.rules.create'];

    const badField = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Bad field',
        field: 'unknown_metric',
        operator: 'gte',
        value: '1000',
        actionConfig: { recipientUserIds: ['u2'], recipientRoleIds: [] },
      },
    });
    expect(badField.statusCode).toBe(400);
    expect(JSON.parse(badField.body).error).toBe('field must be a supported project rule field');

    const badOperator = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Bad operator',
        field: 'status',
        operator: 'gte',
        value: 'active',
        actionConfig: { recipientUserIds: ['u2'], recipientRoleIds: [] },
      },
    });
    expect(badOperator.statusCode).toBe(400);
    expect(JSON.parse(badOperator.body).error).toBe('operator is not valid for field');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('POST rejects an empty conditions array', async () => {
    currentPermissions = ['projects.rules.create'];

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'No conditions',
        conditions: [],
        actionConfig: { recipientUserIds: ['u2'], recipientRoleIds: [] },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('At least one condition is required');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('POST rejects invalid recipients', async () => {
    currentPermissions = ['projects.rules.create'];
    findInvalidRecipientIdsMock.mockResolvedValue({
      userIds: ['u-missing'],
      roleIds: [],
      webhookIds: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Revenue',
        field: 'revenue',
        operator: 'gte',
        value: '1000',
        actionConfig: { recipientUserIds: ['u-missing'], recipientRoleIds: [] },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('actionConfig contains invalid recipients or webhooks');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('POST rejects missing or disabled webhooks', async () => {
    currentPermissions = ['projects.rules.create', 'administration.webhooks.view'];
    findInvalidRecipientIdsMock.mockResolvedValue({
      userIds: [],
      roleIds: [],
      webhookIds: ['webhook-missing'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/rules',
      headers: authHeaders(),
      payload: {
        name: 'Webhook',
        field: 'revenue',
        operator: 'gte',
        value: '1000',
        actionConfig: {
          actions: [{ type: 'webhook', webhookId: 'webhook-missing' }],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('actionConfig contains invalid recipients or webhooks');
    expect(createRuleMock).not.toHaveBeenCalled();
  });

  test('PUT enforces rule ownership under the project', async () => {
    currentPermissions = ['projects.rules.update'];
    findRuleMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-missing',
      headers: authHeaders(),
      payload: { isEnabled: false },
    });

    expect(res.statusCode).toBe(404);
    expect(updateRuleMock).not.toHaveBeenCalled();
  });

  test('PUT rejects an empty update payload', async () => {
    currentPermissions = ['projects.rules.update'];

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('At least one rule field is required');
    expect(findRuleMock).not.toHaveBeenCalled();
    expect(updateRuleMock).not.toHaveBeenCalled();
  });

  test('PUT rejects newly added webhook actions without administration.webhooks.view', async () => {
    currentPermissions = ['projects.rules.update', 'reports.cost.view'];
    findRuleMock.mockResolvedValue(SAMPLE_RULE);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: {
        actionConfig: {
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('actionConfig contains invalid recipients or webhooks');
    expect(findInvalidRecipientIdsMock).not.toHaveBeenCalled();
    expect(updateRuleMock).not.toHaveBeenCalled();
  });

  test('PUT preserves hidden webhook actions when updating visible recipients', async () => {
    currentPermissions = ['projects.rules.update', 'reports.cost.view'];
    const existingRule = {
      ...SAMPLE_RULE,
      actionConfig: {
        ...SAMPLE_RULE.actionConfig,
        webhookIds: ['webhook-1'],
        actions: [...SAMPLE_RULE.actionConfig.actions, { type: 'webhook', webhookId: 'webhook-1' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);
    updateRuleMock.mockImplementation(async (_projectId, _ruleId, patch) => ({
      ...existingRule,
      ...patch,
    }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: {
        actionConfig: {
          actions: [{ type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] }],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateRuleMock).toHaveBeenCalledWith(
      'p1',
      'pr-1',
      expect.objectContaining({
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: ['manager'],
          webhookIds: ['webhook-1'],
          actions: [
            { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
            { type: 'webhook', webhookId: 'webhook-1' },
          ],
        },
      }),
      TX_SENTINEL,
    );
  });

  test('PUT preserves a hidden webhook-only action when visible actions are empty', async () => {
    currentPermissions = ['projects.rules.update', 'reports.cost.view'];
    const existingRule = {
      ...SAMPLE_RULE,
      actionType: 'webhook' as const,
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-1'],
        actions: [{ type: 'webhook' as const, webhookId: 'webhook-1' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);
    updateRuleMock.mockImplementation(async (_projectId, _ruleId, patch) => ({
      ...existingRule,
      ...patch,
    }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: {
        name: 'Renamed webhook rule',
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateRuleMock).toHaveBeenCalledWith(
      'p1',
      'pr-1',
      expect.objectContaining({
        name: 'Renamed webhook rule',
        actionType: 'webhook',
        actionConfig: existingRule.actionConfig,
      }),
      TX_SENTINEL,
    );
    expect(JSON.parse(res.body).actionConfig).toEqual({
      recipientUserIds: [],
      recipientRoleIds: [],
      webhookIds: [],
      actions: [],
    });
  });

  test('PUT marks a rule as webhook-only when no visible actions remain', async () => {
    currentPermissions = ['projects.rules.update', 'reports.cost.view'];
    const existingRule = {
      ...SAMPLE_RULE,
      actionConfig: {
        ...SAMPLE_RULE.actionConfig,
        webhookIds: ['webhook-1'],
        actions: [...SAMPLE_RULE.actionConfig.actions, { type: 'webhook', webhookId: 'webhook-1' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);
    updateRuleMock.mockImplementation(async (_projectId, _ruleId, patch) => ({
      ...existingRule,
      ...patch,
    }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: {
        actionType: 'notify',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: [],
          actions: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateRuleMock).toHaveBeenCalledWith(
      'p1',
      'pr-1',
      expect.objectContaining({
        actionType: 'webhook',
        actionConfig: {
          recipientUserIds: [],
          recipientRoleIds: [],
          webhookIds: ['webhook-1'],
          actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
        },
      }),
      TX_SENTINEL,
    );
    expect(JSON.parse(res.body).actionType).toBe('webhook');
  });

  test('PUT resets condition state when condition fields change', async () => {
    currentPermissions = ['projects.rules.update'];
    const existingRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      value: '1000',
      conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
      conditionMet: true,
    };
    findRuleMock.mockResolvedValue(existingRule);
    updateRuleMock.mockResolvedValue({
      ...existingRule,
      value: '2000',
      conditions: [{ field: 'revenue', operator: 'gte', value: '2000', valueType: 'literal' }],
      conditionMet: false,
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: { value: '2000' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateRuleMock).toHaveBeenCalledWith(
      'p1',
      'pr-1',
      expect.objectContaining({
        value: '2000',
        conditions: [{ field: 'revenue', operator: 'gte', value: '2000', valueType: 'literal' }],
        resetCondition: true,
      }),
      TX_SENTINEL,
    );
  });

  test('PUT resets condition state when a disabled rule is re-enabled', async () => {
    currentPermissions = ['projects.rules.update', 'reports.cost.view'];
    findRuleMock.mockResolvedValue({ ...SAMPLE_RULE, isEnabled: false, conditionMet: true });
    updateRuleMock.mockResolvedValue({ ...SAMPLE_RULE, isEnabled: true, conditionMet: false });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: { isEnabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateRuleMock).toHaveBeenCalledWith(
      'p1',
      'pr-1',
      expect.objectContaining({ isEnabled: true, resetCondition: true }),
      TX_SENTINEL,
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_rule.enabled' }),
    );
  });

  test('PUT rejects re-enabling webhook rules without administration.webhooks.view', async () => {
    currentPermissions = ['projects.rules.update'];
    const existingRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      operator: 'gte',
      value: '1000',
      conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
      isEnabled: false,
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-1'],
        actions: [{ type: 'webhook', webhookId: 'webhook-1' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: { isEnabled: true },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('actionConfig contains invalid recipients or webhooks');
    expect(findInvalidRecipientIdsMock).not.toHaveBeenCalled();
    expect(updateRuleMock).not.toHaveBeenCalled();
  });

  test('PUT rejects edits to enabled rules that reference an inactive hidden webhook', async () => {
    currentPermissions = ['projects.rules.update'];
    const existingRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      operator: 'gte',
      value: '1000',
      conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-disabled'],
        actions: [{ type: 'webhook', webhookId: 'webhook-disabled' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);
    updateRuleMock.mockResolvedValue({ ...existingRule, name: 'Renamed rule' });
    findInvalidRecipientIdsMock.mockImplementation(async (...args: unknown[]) => {
      const options = args[3] as { allowedDisabledWebhookIds?: string[] } | undefined;
      return options?.allowedDisabledWebhookIds?.includes('webhook-disabled')
        ? { userIds: [], roleIds: [], webhookIds: [] }
        : { userIds: [], roleIds: [], webhookIds: ['webhook-disabled'] };
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: { name: 'Renamed rule' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('actionConfig contains invalid recipients or webhooks');
    expect(findInvalidRecipientIdsMock).toHaveBeenCalledWith(
      'p1',
      existingRule.actionConfig,
      TX_SENTINEL,
      { allowedDisabledWebhookIds: [] },
    );
    expect(updateRuleMock).not.toHaveBeenCalled();
  });

  test('PUT can disable a rule that references an existing inactive webhook', async () => {
    currentPermissions = ['projects.rules.update'];
    const existingRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      operator: 'gte',
      value: '1000',
      conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-disabled'],
        actions: [{ type: 'webhook', webhookId: 'webhook-disabled' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);
    updateRuleMock.mockResolvedValue({ ...existingRule, isEnabled: false });
    findInvalidRecipientIdsMock.mockImplementation(async (...args: unknown[]) => {
      const options = args[3] as { allowedDisabledWebhookIds?: string[] } | undefined;
      return options?.allowedDisabledWebhookIds?.includes('webhook-disabled')
        ? { userIds: [], roleIds: [], webhookIds: [] }
        : { userIds: [], roleIds: [], webhookIds: ['webhook-disabled'] };
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: { isEnabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(findInvalidRecipientIdsMock).toHaveBeenCalledWith(
      'p1',
      existingRule.actionConfig,
      TX_SENTINEL,
      { allowedDisabledWebhookIds: ['webhook-disabled'] },
    );
    expect(updateRuleMock).toHaveBeenCalledWith(
      'p1',
      'pr-1',
      expect.objectContaining({ isEnabled: false, resetCondition: false }),
      TX_SENTINEL,
    );
    expect(JSON.parse(res.body).actionConfig).toEqual({
      recipientUserIds: [],
      recipientRoleIds: [],
      webhookIds: [],
      actions: [],
    });
  });

  test('PUT rejects newly added inactive webhooks on disabled rules', async () => {
    currentPermissions = ['projects.rules.update', 'administration.webhooks.view'];
    const existingRule = {
      ...SAMPLE_RULE,
      field: 'revenue',
      operator: 'gte',
      value: '1000',
      conditions: [{ field: 'revenue', operator: 'gte', value: '1000', valueType: 'literal' }],
      isEnabled: false,
      actionConfig: {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-existing'],
        actions: [{ type: 'webhook', webhookId: 'webhook-existing' }],
      },
    };
    findRuleMock.mockResolvedValue(existingRule);
    findInvalidRecipientIdsMock.mockResolvedValue({
      userIds: [],
      roleIds: [],
      webhookIds: ['webhook-new-disabled'],
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
      payload: {
        isEnabled: false,
        actionConfig: {
          actions: [{ type: 'webhook', webhookId: 'webhook-new-disabled' }],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(findInvalidRecipientIdsMock).toHaveBeenCalledWith(
      'p1',
      {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-new-disabled'],
        actions: [{ type: 'webhook', webhookId: 'webhook-new-disabled' }],
      },
      TX_SENTINEL,
      { allowedDisabledWebhookIds: ['webhook-existing'] },
    );
    expect(updateRuleMock).not.toHaveBeenCalled();
  });

  test('DELETE checks ownership and writes an audit log', async () => {
    currentPermissions = ['projects.rules.delete'];
    findRuleMock.mockResolvedValue(SAMPLE_RULE);
    deleteRuleMock.mockResolvedValue(true);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/projects/p1/rules/pr-1',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteRuleMock).toHaveBeenCalledWith('p1', 'pr-1', TX_SENTINEL);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_rule.deleted', entityType: 'project_rule' }),
    );
  });
});
