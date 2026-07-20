import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as projectRuleRecipientsRepo from '../repositories/projectRuleRecipientsRepo.ts';
import * as projectRulesRepo from '../repositories/projectRulesRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import { standardErrorResponses } from '../schemas/common.ts';
import { deriveToggleAction, getAuditChangedFields, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { NotFoundError } from '../utils/http-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { makeAccessChecker } from '../utils/permissions.ts';
import {
  getProjectRuleFieldDefinition,
  isProjectRuleConditionValueType,
  validateProjectRuleCondition,
} from '../utils/projectRuleFields.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  parseBooleanField,
  requireNonEmptyString,
} from '../utils/validation.ts';

const projectIdParamSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string' },
  },
  required: ['projectId'],
} as const;

const projectRuleIdParamSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string' },
    ruleId: { type: 'string' },
  },
  required: ['projectId', 'ruleId'],
} as const;

const projectRuleActionSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['notify', 'webhook'] },
    recipientType: { type: 'string', enum: ['user', 'role'] },
    recipientUserIds: { type: 'array', items: { type: 'string' } },
    recipientRoleIds: { type: 'array', items: { type: 'string' } },
    webhookId: {
      type: 'string',
      description: 'Requires administration.webhooks.view when supplied.',
    },
  },
  required: ['type'],
  additionalProperties: false,
} as const;

const actionConfigResponseSchema = {
  type: 'object',
  properties: {
    recipientUserIds: { type: 'array', items: { type: 'string' } },
    recipientRoleIds: { type: 'array', items: { type: 'string' } },
    webhookIds: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: projectRuleActionSchema },
  },
  required: ['recipientUserIds', 'recipientRoleIds', 'webhookIds', 'actions'],
  additionalProperties: false,
} as const;

const actionConfigInputSchema = {
  type: 'object',
  properties: actionConfigResponseSchema.properties,
  additionalProperties: false,
} as const;

const projectRuleConditionSchema = {
  type: 'object',
  properties: {
    field: { type: 'string' },
    operator: { type: 'string' },
    value: { type: 'string' },
    valueType: { type: 'string', enum: ['literal', 'field'] },
  },
  required: ['field', 'operator', 'value'],
  additionalProperties: false,
} as const;

const projectRuleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    projectId: { type: 'string' },
    name: { type: 'string' },
    field: { type: 'string' },
    operator: { type: 'string' },
    value: { type: 'string' },
    conditionLogic: { type: 'string', enum: ['and', 'or'] },
    conditions: { type: 'array', items: projectRuleConditionSchema },
    actionType: { type: 'string' },
    actionConfig: {
      ...actionConfigResponseSchema,
      description:
        'Webhook IDs and actions are omitted unless the caller has administration.webhooks.view.',
    },
    isEnabled: { type: 'boolean' },
    conditionMet: { type: 'boolean' },
    lastTriggeredAt: { type: ['number', 'null'] },
    createdBy: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: [
    'id',
    'projectId',
    'name',
    'field',
    'operator',
    'value',
    'conditionLogic',
    'conditions',
    'actionType',
    'actionConfig',
    'isEnabled',
    'conditionMet',
    'lastTriggeredAt',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
} as const;

const recipientOptionsSchema = {
  type: 'object',
  properties: {
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          username: { type: 'string' },
          avatarInitials: { type: 'string' },
        },
        required: ['id', 'name', 'username', 'avatarInitials'],
      },
    },
    roles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
    webhooks: {
      type: 'array',
      description:
        'Enabled webhook targets. Empty unless the caller has administration.webhooks.view.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
  },
  required: ['users', 'roles', 'webhooks'],
} as const;

const projectRuleCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    field: { type: 'string' },
    operator: { type: 'string' },
    value: { type: 'string' },
    conditionLogic: { type: 'string', enum: ['and', 'or'] },
    conditions: { type: 'array', items: projectRuleConditionSchema },
    actionType: { type: 'string' },
    actionConfig: actionConfigInputSchema,
    isEnabled: { type: 'boolean' },
  },
  required: ['name', 'actionConfig'],
  additionalProperties: false,
} as const;

const projectRuleUpdateBodySchema = {
  type: 'object',
  properties: projectRuleCreateBodySchema.properties,
  additionalProperties: false,
} as const;

type ProjectRuleBody = Record<string, unknown>;

class RecipientValidationError extends Error {}

const WEBHOOK_USE_PERMISSION = 'administration.webhooks.view';

const canUseRuleWebhooks = (permissions: readonly string[]) =>
  permissions.includes(WEBHOOK_USE_PERMISSION);

const redactRuleWebhooks = (rule: projectRulesRepo.ProjectRule): projectRulesRepo.ProjectRule => {
  const actions = rule.actionConfig.actions.filter((action) => action.type !== 'webhook');
  const hasHiddenWebhooks =
    rule.actionConfig.webhookIds.length > 0 ||
    rule.actionConfig.actions.some((action) => action.type === 'webhook');
  return {
    ...rule,
    actionType: actions[0]?.type ?? (hasHiddenWebhooks ? 'webhook' : rule.actionType),
    actionConfig: {
      ...rule.actionConfig,
      webhookIds: [],
      actions,
    },
  };
};

const preserveExistingRuleWebhooks = (
  actionConfig: projectRulesRepo.ProjectRule['actionConfig'],
  existingWebhookIds: readonly string[],
) =>
  projectRulesRepo.normalizeProjectRuleActionConfig({
    ...actionConfig,
    webhookIds: [...existingWebhookIds],
  });

const canAccessProject = makeAccessChecker(
  (userId, projectId) => userAssignmentsRepo.isProjectAssignedToUser(userId, projectId),
  'projects.manage_all.view',
);

const parseActionConfig = (
  value: unknown,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
):
  | { ok: true; value: projectRulesRepo.ProjectRule['actionConfig'] }
  | { ok: false; message: string } => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const recipientUserIds = ensureArrayOfStrings(raw.recipientUserIds ?? [], 'recipientUserIds');
  if (!recipientUserIds.ok) return { ok: false, message: recipientUserIds.message };
  const recipientRoleIds = ensureArrayOfStrings(raw.recipientRoleIds ?? [], 'recipientRoleIds');
  if (!recipientRoleIds.ok) return { ok: false, message: recipientRoleIds.message };
  const webhookIds = ensureArrayOfStrings(raw.webhookIds ?? [], 'webhookIds');
  if (!webhookIds.ok) return { ok: false, message: webhookIds.message };

  const actions: projectRulesRepo.ProjectRule['actionConfig']['actions'] = [];
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions)) return { ok: false, message: 'actions must be an array' };
    for (const [index, rawAction] of raw.actions.entries()) {
      if (!rawAction || typeof rawAction !== 'object') {
        return { ok: false, message: `actions[${index}] must be an object` };
      }
      const action = rawAction as Record<string, unknown>;
      const actionType = requireNonEmptyString(action.type, `actions[${index}].type`);
      if (!actionType.ok) return { ok: false, message: actionType.message };

      if (actionType.value === 'notify') {
        const recipientType = requireNonEmptyString(
          action.recipientType,
          `actions[${index}].recipientType`,
        );
        if (!recipientType.ok) return { ok: false, message: recipientType.message };
        if (recipientType.value !== 'user' && recipientType.value !== 'role') {
          return {
            ok: false,
            message: `actions[${index}].recipientType must be user or role`,
          };
        }
        if (recipientType.value === 'user') {
          const ids = ensureArrayOfStrings(
            action.recipientUserIds ?? [],
            `actions[${index}].recipientUserIds`,
          );
          if (!ids.ok) return { ok: false, message: ids.message };
          if (ids.value.length === 0) {
            return {
              ok: false,
              message: `actions[${index}].recipientUserIds must include at least one value`,
            };
          }
          actions.push({
            type: 'notify',
            recipientType: 'user',
            recipientUserIds: ids.value,
          });
        } else {
          const ids = ensureArrayOfStrings(
            action.recipientRoleIds ?? [],
            `actions[${index}].recipientRoleIds`,
          );
          if (!ids.ok) return { ok: false, message: ids.message };
          if (ids.value.length === 0) {
            return {
              ok: false,
              message: `actions[${index}].recipientRoleIds must include at least one value`,
            };
          }
          actions.push({
            type: 'notify',
            recipientType: 'role',
            recipientRoleIds: ids.value,
          });
        }
        continue;
      }

      if (actionType.value === 'webhook') {
        const webhookId = requireNonEmptyString(action.webhookId, `actions[${index}].webhookId`);
        if (!webhookId.ok) return { ok: false, message: webhookId.message };
        actions.push({ type: 'webhook', webhookId: webhookId.value });
        continue;
      }

      return { ok: false, message: `actions[${index}].type must be notify or webhook` };
    }
  }

  const normalized = projectRulesRepo.normalizeProjectRuleActionConfig({
    recipientUserIds: recipientUserIds.value,
    recipientRoleIds: recipientRoleIds.value,
    webhookIds: webhookIds.value,
    actions,
  });
  if (!allowEmpty && normalized.actions.length === 0) {
    return { ok: false, message: 'At least one rule action is required' };
  }
  return { ok: true, value: normalized };
};

const parseActionType = (
  value: unknown,
  fallback: projectRulesRepo.ProjectRule['actionType'],
):
  | { ok: true; value: projectRulesRepo.ProjectRule['actionType'] }
  | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, value: fallback };
  const actionType = requireNonEmptyString(value, 'actionType');
  if (!actionType.ok) return actionType;
  if (actionType.value !== 'notify' && actionType.value !== 'webhook') {
    return { ok: false, message: 'actionType must be notify or webhook' };
  }
  return { ok: true, value: actionType.value };
};

const parseConditionLogic = (
  value: unknown,
):
  | { ok: true; value: projectRulesRepo.ProjectRuleConditionLogic }
  | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, value: 'and' };
  const result = requireNonEmptyString(value, 'conditionLogic');
  if (!result.ok) return { ok: false, message: result.message };
  if (result.value !== 'and' && result.value !== 'or') {
    return { ok: false, message: 'conditionLogic must be "and" or "or"' };
  }
  return { ok: true, value: result.value };
};

const parseCondition = (
  value: unknown,
  index: number,
): { ok: true; value: projectRulesRepo.ProjectRuleCondition } | { ok: false; message: string } => {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: `conditions[${index}] must be an object` };
  }
  const raw = value as ProjectRuleBody;
  const field = requireNonEmptyString(raw.field, `conditions[${index}].field`);
  if (!field.ok) return { ok: false, message: field.message };
  const operator = requireNonEmptyString(raw.operator, `conditions[${index}].operator`);
  if (!operator.ok) return { ok: false, message: operator.message };
  const conditionValue = requireNonEmptyString(raw.value, `conditions[${index}].value`);
  if (!conditionValue.ok) return { ok: false, message: conditionValue.message };
  const valueTypeResult =
    raw.valueType === undefined
      ? ({ ok: true, value: 'literal' } as const)
      : requireNonEmptyString(raw.valueType, `conditions[${index}].valueType`);
  if (!valueTypeResult.ok) return { ok: false, message: valueTypeResult.message };
  if (!isProjectRuleConditionValueType(valueTypeResult.value)) {
    return { ok: false, message: `conditions[${index}].valueType must be literal or field` };
  }
  return {
    ok: true,
    value: {
      field: field.value,
      operator: operator.value,
      value: conditionValue.value,
      valueType: valueTypeResult.value,
    },
  };
};

const parseConditions = (
  value: unknown,
):
  | { ok: true; value: projectRulesRepo.ProjectRuleCondition[] }
  | { ok: false; message: string } => {
  if (!Array.isArray(value)) return { ok: false, message: 'conditions must be an array' };
  if (value.length === 0) return { ok: false, message: 'At least one condition is required' };
  const conditions: projectRulesRepo.ProjectRuleCondition[] = [];
  for (const [index, rawCondition] of value.entries()) {
    const condition = parseCondition(rawCondition, index);
    if (!condition.ok) return condition;
    conditions.push(condition.value);
  }
  return { ok: true, value: conditions };
};

const parseLegacySingleCondition = (
  body: ProjectRuleBody,
): { ok: true; value: projectRulesRepo.ProjectRuleCondition } | { ok: false; message: string } => {
  const field = requireNonEmptyString(body.field, 'field');
  if (!field.ok) return { ok: false, message: field.message };
  const operator = requireNonEmptyString(body.operator, 'operator');
  if (!operator.ok) return { ok: false, message: operator.message };
  const value = requireNonEmptyString(body.value, 'value');
  if (!value.ok) return { ok: false, message: value.message };
  return {
    ok: true,
    value: {
      field: field.value,
      operator: operator.value,
      value: value.value,
      valueType: 'literal',
    },
  };
};

const parseCreateBody = (
  body: ProjectRuleBody,
):
  | { ok: true; value: Omit<projectRulesRepo.NewProjectRule, 'id' | 'projectId' | 'createdBy'> }
  | { ok: false; message: string } => {
  const name = requireNonEmptyString(body.name, 'name');
  if (!name.ok) return { ok: false, message: name.message };
  const conditions = Object.hasOwn(body, 'conditions')
    ? parseConditions(body.conditions)
    : (() => {
        const condition = parseLegacySingleCondition(body);
        return condition.ok ? { ok: true as const, value: [condition.value] } : condition;
      })();
  if (!conditions.ok) return { ok: false, message: conditions.message };
  const conditionLogic = parseConditionLogic(body.conditionLogic);
  if (!conditionLogic.ok) return conditionLogic;
  const primary = conditions.value[0];
  const actionConfig = parseActionConfig(body.actionConfig);
  if (!actionConfig.ok) return actionConfig;
  const firstActionType = actionConfig.value.actions[0]?.type ?? 'notify';
  const actionTypeResult = parseActionType(body.actionType, firstActionType);
  if (!actionTypeResult.ok) return actionTypeResult;
  const isEnabled = parseBooleanField(body, 'isEnabled');
  if (!isEnabled.ok) return { ok: false, message: isEnabled.message };

  return {
    ok: true,
    value: {
      name: name.value,
      field: primary.field,
      operator: primary.operator,
      value: primary.value,
      conditionLogic: conditionLogic.value,
      conditions: conditions.value,
      actionType: actionTypeResult.value,
      actionConfig: actionConfig.value,
      isEnabled: isEnabled.value ?? true,
    },
  };
};

const parseUpdateBody = (
  body: ProjectRuleBody,
): { ok: true; value: projectRulesRepo.ProjectRuleUpdate } | { ok: false; message: string } => {
  const patch: projectRulesRepo.ProjectRuleUpdate = {};
  if (Object.hasOwn(body, 'name')) {
    const result = requireNonEmptyString(body.name, 'name');
    if (!result.ok) return { ok: false, message: result.message };
    patch.name = result.value;
  }
  if (Object.hasOwn(body, 'field')) {
    const result = requireNonEmptyString(body.field, 'field');
    if (!result.ok) return { ok: false, message: result.message };
    patch.field = result.value;
  }
  if (Object.hasOwn(body, 'operator')) {
    const result = requireNonEmptyString(body.operator, 'operator');
    if (!result.ok) return { ok: false, message: result.message };
    patch.operator = result.value;
  }
  if (Object.hasOwn(body, 'value')) {
    const result = requireNonEmptyString(body.value, 'value');
    if (!result.ok) return { ok: false, message: result.message };
    patch.value = result.value;
  }
  if (Object.hasOwn(body, 'conditionLogic')) {
    const result = parseConditionLogic(body.conditionLogic);
    if (!result.ok) return { ok: false, message: result.message };
    patch.conditionLogic = result.value;
  }
  if (Object.hasOwn(body, 'conditions')) {
    const result = parseConditions(body.conditions);
    if (!result.ok) return { ok: false, message: result.message };
    patch.conditions = result.value;
    const primary = result.value[0];
    patch.field = primary.field;
    patch.operator = primary.operator;
    patch.value = primary.value;
  }
  if (Object.hasOwn(body, 'actionType')) {
    const result = parseActionType(body.actionType, 'notify');
    if (!result.ok) return result;
    patch.actionType = result.value;
  }
  if (Object.hasOwn(body, 'actionConfig')) {
    const result = parseActionConfig(body.actionConfig, { allowEmpty: true });
    if (!result.ok) return result;
    patch.actionConfig = result.value;
    if (!Object.hasOwn(body, 'actionType')) {
      patch.actionType = result.value.actions[0]?.type ?? 'notify';
    }
  }
  const isEnabled = parseBooleanField(body, 'isEnabled');
  if (!isEnabled.ok) return { ok: false, message: isEnabled.message };
  if (isEnabled.value !== undefined) patch.isEnabled = isEnabled.value;

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'At least one rule field is required' };
  }

  return { ok: true, value: patch };
};

const validateFinalRule = async ({
  projectId,
  rule,
  permissions,
  exec,
  allowedDisabledWebhookIds,
}: {
  projectId: string;
  rule: Pick<
    projectRulesRepo.ProjectRule,
    'conditions' | 'conditionLogic' | 'actionType' | 'actionConfig'
  >;
  permissions: readonly string[];
  exec?: DbExecutor;
  allowedDisabledWebhookIds?: readonly string[];
}) => {
  if (rule.actionType !== 'notify' && rule.actionType !== 'webhook') {
    throw new RecipientValidationError('actionType must be notify or webhook');
  }

  if (rule.conditionLogic !== 'and' && rule.conditionLogic !== 'or') {
    throw new RecipientValidationError('conditionLogic must be "and" or "or"');
  }
  if (rule.conditions.length === 0) {
    throw new RecipientValidationError('At least one condition is required');
  }
  if (rule.actionConfig.actions.length === 0) {
    throw new RecipientValidationError('At least one rule action is required');
  }
  const permissionSet = new Set(permissions);
  for (const conditionInput of rule.conditions) {
    const definition = getProjectRuleFieldDefinition(conditionInput.field);
    const condition = validateProjectRuleCondition({
      field: conditionInput.field,
      operator: conditionInput.operator,
      value: conditionInput.value,
      valueType: conditionInput.valueType,
      permissions,
    });
    if (!condition.ok) throw new RecipientValidationError(condition.message);
    if (definition?.requiresPermission && !permissionSet.has(definition.requiresPermission)) {
      throw new RecipientValidationError(
        `${conditionInput.field} requires ${definition.requiresPermission}`,
      );
    }
  }

  const allowedDisabledWebhookIdSet = new Set(allowedDisabledWebhookIds ?? []);
  if (
    !canUseRuleWebhooks(permissions) &&
    rule.actionConfig.webhookIds.some((id) => !allowedDisabledWebhookIdSet.has(id))
  ) {
    throw new RecipientValidationError('actionConfig contains invalid recipients or webhooks');
  }

  const invalidRecipients = await projectRuleRecipientsRepo.findInvalidRecipientIds(
    projectId,
    rule.actionConfig,
    exec,
    { allowedDisabledWebhookIds },
  );
  if (
    invalidRecipients.userIds.length > 0 ||
    invalidRecipients.roleIds.length > 0 ||
    invalidRecipients.webhookIds.length > 0
  ) {
    throw new RecipientValidationError('actionConfig contains invalid recipients or webhooks');
  }
};

const mergeRuleConditions = (
  existing: projectRulesRepo.ProjectRule,
  patch: projectRulesRepo.ProjectRuleUpdate,
) => {
  const existingConditions =
    existing.conditions.length > 0
      ? existing.conditions
      : [
          {
            field: existing.field,
            operator: existing.operator,
            value: existing.value,
            valueType: 'literal' as const,
          },
        ];
  const conditionFieldsChanged =
    patch.field !== undefined || patch.operator !== undefined || patch.value !== undefined;

  if (patch.conditions !== undefined) {
    return patch.conditions;
  }

  if (!conditionFieldsChanged) return existingConditions;

  const first = {
    field: patch.field ?? existingConditions[0].field,
    operator: patch.operator ?? existingConditions[0].operator,
    value: patch.value ?? existingConditions[0].value,
    valueType: 'literal' as const,
  };
  return [first, ...existingConditions.slice(1)];
};

const ensureProjectAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
  action: string,
) => {
  if (await canAccessProject(request, projectId)) return true;
  await replyError(request, reply, {
    statusCode: 403,
    message: 'Insufficient permissions',
    action,
    entityType: 'project',
    entityId: projectId,
    details: { secondaryLabel: 'project_access_denied' },
  });
  return false;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/:projectId/rules/recipients',
    {
      onRequest: [authenticateToken, requirePermission('projects.rules.view')],
      schema: {
        tags: ['projects'],
        summary: 'List project rule recipient options',
        params: projectIdParamSchema,
        response: {
          200: recipientOptionsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const id = requireNonEmptyString(projectId, 'projectId');
      if (!id.ok) return badRequest(reply, id.message);
      if (
        !(await ensureProjectAccess(request, reply, id.value, 'project_rule.recipients.denied'))
      ) {
        return;
      }
      const options = await projectRuleRecipientsRepo.listRecipientOptions(id.value);
      return canUseRuleWebhooks(request.user?.permissions ?? [])
        ? options
        : { ...options, webhooks: [] };
    },
  );

  fastify.get(
    '/:projectId/rules',
    {
      onRequest: [authenticateToken, requirePermission('projects.rules.view')],
      schema: {
        tags: ['projects'],
        summary: 'List project rules',
        params: projectIdParamSchema,
        response: {
          200: { type: 'array', items: projectRuleSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const id = requireNonEmptyString(projectId, 'projectId');
      if (!id.ok) return badRequest(reply, id.message);
      if (!(await ensureProjectAccess(request, reply, id.value, 'project_rule.list.denied')))
        return;
      const rules = await projectRulesRepo.listByProject(id.value);
      return canUseRuleWebhooks(request.user?.permissions ?? [])
        ? rules
        : rules.map(redactRuleWebhooks);
    },
  );

  fastify.post(
    '/:projectId/rules',
    {
      onRequest: [authenticateToken, requirePermission('projects.rules.create')],
      schema: {
        tags: ['projects'],
        summary: 'Create project rule',
        params: projectIdParamSchema,
        body: projectRuleCreateBodySchema,
        response: {
          201: projectRuleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { projectId } = request.params as { projectId: string };
      const id = requireNonEmptyString(projectId, 'projectId');
      if (!id.ok) return badRequest(reply, id.message);
      if (!(await ensureProjectAccess(request, reply, id.value, 'project_rule.create.denied'))) {
        return;
      }
      const parsed = parseCreateBody(request.body as ProjectRuleBody);
      if (!parsed.ok) return badRequest(reply, parsed.message);

      const ruleId = generatePrefixedId('pr');
      let created: projectRulesRepo.ProjectRule;
      let projectName = '';
      try {
        created = await withDbTransaction(async (tx) => {
          const project = await projectsRepo.findClientIdAndName(id.value, tx);
          if (!project) throw new NotFoundError('Project');
          await validateFinalRule({
            projectId: id.value,
            rule: parsed.value,
            permissions: request.user.permissions ?? [],
            exec: tx,
          });
          projectName = project.name;
          return projectRulesRepo.create(
            {
              id: ruleId,
              projectId: id.value,
              createdBy: request.user.id,
              ...parsed.value,
            },
            tx,
          );
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return replyError(request, reply, {
            statusCode: 404,
            message: err.message,
            action: 'project_rule.create.not_found',
            entityType: 'project',
            entityId: id.value,
          });
        }
        if (err instanceof RecipientValidationError) return badRequest(reply, err.message);
        throw err;
      }

      await logAudit({
        request,
        action: 'project_rule.created',
        entityType: 'project_rule',
        entityId: created.id,
        details: {
          targetLabel: created.name,
          secondaryLabel: projectName,
          counts: {
            recipientUsers: created.actionConfig.recipientUserIds.length,
            recipientRoles: created.actionConfig.recipientRoleIds.length,
            webhooks: created.actionConfig.webhookIds.length,
          },
        },
      });
      return reply.code(201).send(created);
    },
  );

  fastify.put(
    '/:projectId/rules/:ruleId',
    {
      onRequest: [authenticateToken, requirePermission('projects.rules.update')],
      schema: {
        tags: ['projects'],
        summary: 'Update project rule',
        params: projectRuleIdParamSchema,
        body: projectRuleUpdateBodySchema,
        response: {
          200: projectRuleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { projectId, ruleId } = request.params as { projectId: string; ruleId: string };
      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);
      const ruleIdResult = requireNonEmptyString(ruleId, 'ruleId');
      if (!ruleIdResult.ok) return badRequest(reply, ruleIdResult.message);
      if (
        !(await ensureProjectAccess(
          request,
          reply,
          projectIdResult.value,
          'project_rule.update.denied',
        ))
      ) {
        return;
      }
      const parsed = parseUpdateBody(request.body as ProjectRuleBody);
      if (!parsed.ok) return badRequest(reply, parsed.message);
      const permissions = request.user?.permissions ?? [];
      const mayUseRuleWebhooks = canUseRuleWebhooks(permissions);

      let updated: projectRulesRepo.ProjectRule;
      let projectName = '';
      try {
        updated = await withDbTransaction(async (tx) => {
          const [project, existing] = await Promise.all([
            projectsRepo.findClientIdAndName(projectIdResult.value, tx),
            projectRulesRepo.findByProjectAndId(projectIdResult.value, ruleIdResult.value, tx),
          ]);
          if (!project) throw new NotFoundError('Project');
          if (!existing) throw new NotFoundError('Project rule');
          if (!mayUseRuleWebhooks && parsed.value.actionConfig?.webhookIds.length) {
            throw new RecipientValidationError(
              'actionConfig contains invalid recipients or webhooks',
            );
          }

          const existingActionConfig = projectRulesRepo.normalizeProjectRuleActionConfig(
            existing.actionConfig,
          );
          const actionConfig =
            parsed.value.actionConfig === undefined
              ? existingActionConfig
              : mayUseRuleWebhooks
                ? parsed.value.actionConfig
                : preserveExistingRuleWebhooks(
                    parsed.value.actionConfig,
                    existingActionConfig.webhookIds,
                  );
          const updatePatch = { ...parsed.value };
          if (parsed.value.actionConfig !== undefined) updatePatch.actionConfig = actionConfig;
          if (
            !mayUseRuleWebhooks &&
            existingActionConfig.webhookIds.length > 0 &&
            parsed.value.actionType !== undefined
          ) {
            updatePatch.actionType =
              parsed.value.actionConfig === undefined
                ? existing.actionType
                : (actionConfig.actions[0]?.type ?? existing.actionType);
          }

          const finalConditions = mergeRuleConditions(existing, parsed.value);
          const primary = finalConditions[0];
          const finalConditionLogic = parsed.value.conditionLogic ?? existing.conditionLogic;
          const reEnabled = parsed.value.isEnabled === true && existing.isEnabled === false;
          const finalRule = {
            ...existing,
            ...updatePatch,
            field: primary.field,
            operator: primary.operator,
            value: primary.value,
            conditionLogic: finalConditionLogic,
            conditions: finalConditions,
            actionConfig,
          };
          await validateFinalRule({
            projectId: projectIdResult.value,
            rule: finalRule,
            permissions,
            exec: tx,
            allowedDisabledWebhookIds:
              !reEnabled && (!mayUseRuleWebhooks || !finalRule.isEnabled)
                ? existingActionConfig.webhookIds
                : [],
          });

          const conditionChanged =
            parsed.value.field !== undefined ||
            parsed.value.operator !== undefined ||
            parsed.value.value !== undefined ||
            parsed.value.conditions !== undefined ||
            parsed.value.conditionLogic !== undefined;
          projectName = project.name;
          const result = await projectRulesRepo.update(
            projectIdResult.value,
            ruleIdResult.value,
            {
              ...updatePatch,
              field: primary.field,
              operator: primary.operator,
              value: primary.value,
              conditionLogic: finalConditionLogic,
              conditions: finalConditions,
              resetCondition: conditionChanged || reEnabled,
            },
            tx,
          );
          if (!result) throw new NotFoundError('Project rule');
          return result;
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return replyError(request, reply, {
            statusCode: 404,
            message: err.message,
            action: 'project_rule.update.not_found',
            entityType: 'project_rule',
            entityId: ruleIdResult.value,
          });
        }
        if (err instanceof RecipientValidationError) return badRequest(reply, err.message);
        throw err;
      }

      const changedFields = getAuditChangedFields(request.body as Record<string, unknown>);
      await logAudit({
        request,
        action: deriveToggleAction(
          changedFields,
          'isEnabled',
          'project_rule.updated',
          'project_rule.enabled',
          'project_rule.disabled',
          (request.body as { isEnabled?: boolean }).isEnabled,
        ),
        entityType: 'project_rule',
        entityId: updated.id,
        details: {
          targetLabel: updated.name,
          secondaryLabel: projectName,
          changedFields,
        },
      });
      return mayUseRuleWebhooks ? updated : redactRuleWebhooks(updated);
    },
  );

  fastify.delete(
    '/:projectId/rules/:ruleId',
    {
      onRequest: [authenticateToken, requirePermission('projects.rules.delete')],
      schema: {
        tags: ['projects'],
        summary: 'Delete project rule',
        params: projectRuleIdParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { projectId, ruleId } = request.params as { projectId: string; ruleId: string };
      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);
      const ruleIdResult = requireNonEmptyString(ruleId, 'ruleId');
      if (!ruleIdResult.ok) return badRequest(reply, ruleIdResult.message);
      if (
        !(await ensureProjectAccess(
          request,
          reply,
          projectIdResult.value,
          'project_rule.delete.denied',
        ))
      ) {
        return;
      }

      let deleted: projectRulesRepo.ProjectRule;
      try {
        deleted = await withDbTransaction(async (tx) => {
          const existing = await projectRulesRepo.findByProjectAndId(
            projectIdResult.value,
            ruleIdResult.value,
            tx,
          );
          if (!existing) throw new NotFoundError('Project rule');
          const ok = await projectRulesRepo.deleteByProjectAndId(
            projectIdResult.value,
            ruleIdResult.value,
            tx,
          );
          if (!ok) throw new NotFoundError('Project rule');
          return existing;
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return replyError(request, reply, {
            statusCode: 404,
            message: err.message,
            action: 'project_rule.delete.not_found',
            entityType: 'project_rule',
            entityId: ruleIdResult.value,
          });
        }
        throw err;
      }

      await logAudit({
        request,
        action: 'project_rule.deleted',
        entityType: 'project_rule',
        entityId: deleted.id,
        details: { targetLabel: deleted.name, secondaryLabel: deleted.projectId },
      });
      return reply.code(204).send();
    },
  );
}
