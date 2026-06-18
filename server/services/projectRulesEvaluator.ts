import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as projectMetricsRepo from '../repositories/projectMetricsRepo.ts';
import * as projectRuleRecipientsRepo from '../repositories/projectRuleRecipientsRepo.ts';
import * as projectRulesRepo from '../repositories/projectRulesRepo.ts';
import { serializeError } from '../utils/logger.ts';
import { evaluateProjectRuleCondition } from '../utils/projectRuleFields.ts';
import * as webhooksService from './webhooks.ts';

export const PROJECT_RULE_TRIGGERED_NOTIFICATION_TYPE = 'project_rule_triggered';

export type ProjectRulesEvaluatorLogger = {
  error: (obj: unknown, message?: string) => void;
  warn?: (obj: unknown, message?: string) => void;
  info?: (obj: unknown, message?: string) => void;
};

export type EvaluateProjectRulesOptions = {
  now?: Date;
  logger?: ProjectRulesEvaluatorLogger;
  exec?: DbExecutor;
};

export type ProjectRulesEvaluationResult = {
  evaluated: number;
  triggered: number;
  reset: number;
  notified: number;
};

const buildNotification = (rule: projectRulesRepo.ProjectRule, projectName: string) => ({
  type: PROJECT_RULE_TRIGGERED_NOTIFICATION_TYPE,
  title: 'Project rule triggered',
  message: `${rule.name} triggered for ${projectName}`,
  data: {
    projectId: rule.projectId,
    projectName,
    ruleId: rule.id,
    ruleName: rule.name,
  },
});

const buildWebhookPayload = (
  rule: projectRulesRepo.ProjectRule,
  metrics: projectMetricsRepo.ProjectRuleMetrics,
  now: Date,
): webhooksService.WebhookDispatchPayload => ({
  eventType: PROJECT_RULE_TRIGGERED_NOTIFICATION_TYPE,
  triggeredAt: now.toISOString(),
  project: {
    id: rule.projectId,
    name: metrics.projectName,
  },
  rule: {
    id: rule.id,
    name: rule.name,
    conditionLogic: rule.conditionLogic,
    conditions: rule.conditions,
  },
  metrics: {
    revenue: metrics.revenue,
    costToDate: metrics.costToDate,
    budgetUsedPct: metrics.budgetUsedPct,
    hoursToDate: metrics.hoursToDate,
    daysUntilDeadline: metrics.daysUntilDeadline,
    billingType: metrics.billingType,
    status: metrics.status,
  },
});

const logWebhookWarning = (
  logger: ProjectRulesEvaluatorLogger | undefined,
  obj: unknown,
  message: string,
) => {
  if (logger?.warn) {
    logger.warn(obj, message);
    return;
  }
  logger?.error(obj, message);
};

const dispatchRuleWebhooks = async ({
  logger,
  payload,
  rule,
  webhookIds,
}: {
  logger?: ProjectRulesEvaluatorLogger;
  payload: webhooksService.WebhookDispatchPayload;
  rule: projectRulesRepo.ProjectRule;
  webhookIds: string[];
}) => {
  await Promise.all(
    webhookIds.map(async (webhookId) => {
      try {
        const dispatchResult = await webhooksService.dispatchWebhookById(webhookId, payload);
        if (dispatchResult.skipped) {
          logWebhookWarning(
            logger,
            {
              webhookId,
              ruleId: rule.id,
              projectId: rule.projectId,
              reason: dispatchResult.reason,
            },
            'Project rule webhook skipped',
          );
        }
      } catch (err) {
        logWebhookWarning(
          logger,
          {
            err: serializeError(err),
            webhookId,
            ruleId: rule.id,
            projectId: rule.projectId,
          },
          'Project rule webhook dispatch failed',
        );
      }
    }),
  );
};

const evaluateRuleConditions = (
  rule: projectRulesRepo.ProjectRule,
  metrics: projectMetricsRepo.ProjectRuleMetrics,
) => {
  const conditions =
    rule.conditions.length > 0
      ? rule.conditions
      : [
          {
            field: rule.field,
            operator: rule.operator,
            value: rule.value,
            valueType: 'literal' as const,
          },
        ];
  const evaluate = (condition: projectRulesRepo.ProjectRuleCondition) => {
    const expectedActualValue =
      condition.valueType === 'field'
        ? projectMetricsRepo.metricValueForField(metrics, condition.value)
        : undefined;
    return evaluateProjectRuleCondition({
      field: condition.field,
      operator: condition.operator,
      expectedValue: condition.value,
      expectedValueType: condition.valueType,
      actualValue: projectMetricsRepo.metricValueForField(metrics, condition.field),
      expectedActualValue,
    });
  };

  return rule.conditionLogic === 'or' ? conditions.some(evaluate) : conditions.every(evaluate);
};

export const evaluateProjectRulesOnce = async ({
  now = new Date(),
  logger,
  exec = db,
}: EvaluateProjectRulesOptions = {}): Promise<ProjectRulesEvaluationResult> => {
  const rules = await projectRulesRepo.listEnabled(exec);
  const metricsByProjectId = await projectMetricsRepo.listForProjects(
    rules.map((rule) => rule.projectId),
    now,
    exec,
  );

  const result: ProjectRulesEvaluationResult = {
    evaluated: 0,
    triggered: 0,
    reset: 0,
    notified: 0,
  };

  const outcomes = await Promise.all(
    rules.map(async (rule): Promise<ProjectRulesEvaluationResult> => {
      try {
        const metrics = metricsByProjectId.get(rule.projectId);
        const conditionMet = metrics !== undefined && evaluateRuleConditions(rule, metrics);

        if (!conditionMet) {
          const reset = (await projectRulesRepo.markConditionNotMet(rule.id, exec)) ? 1 : 0;
          return { evaluated: 1, triggered: 0, reset, notified: 0 };
        }

        if (!metrics) return { evaluated: 1, triggered: 0, reset: 0, notified: 0 };

        const outcome = await runAtomically(exec, async (tx) => {
          const acquired = await projectRulesRepo.markTriggeredOnRisingEdge(rule.id, now, tx);
          if (!acquired) {
            return {
              evaluated: 1,
              triggered: 0,
              reset: 0,
              notified: 0,
              webhookIds: [],
              webhookPayload: null,
            };
          }

          const actionConfig = projectRulesRepo.normalizeProjectRuleActionConfig(rule.actionConfig);
          const hasNotificationRecipients =
            actionConfig.recipientUserIds.length + actionConfig.recipientRoleIds.length > 0;
          const recipientUserIds = hasNotificationRecipients
            ? await projectRuleRecipientsRepo.resolveRecipientUserIds(
                rule.projectId,
                actionConfig,
                tx,
              )
            : [];
          const notified =
            recipientUserIds.length > 0
              ? await notificationsRepo.createForUsers(
                  recipientUserIds,
                  buildNotification(rule, metrics.projectName),
                  tx,
                )
              : 0;
          return {
            evaluated: 1,
            triggered: 1,
            reset: 0,
            notified,
            webhookIds: actionConfig.webhookIds,
            webhookPayload: buildWebhookPayload(rule, metrics, now),
          };
        });
        if (outcome.triggered && outcome.webhookIds.length > 0 && outcome.webhookPayload) {
          await dispatchRuleWebhooks({
            logger,
            payload: outcome.webhookPayload,
            rule,
            webhookIds: outcome.webhookIds,
          });
        }
        return {
          evaluated: outcome.evaluated,
          triggered: outcome.triggered,
          reset: outcome.reset,
          notified: outcome.notified,
        };
      } catch (err) {
        logger?.error(
          { err: serializeError(err), ruleId: rule.id, projectId: rule.projectId },
          'Project rule evaluation failed',
        );
        return { evaluated: 1, triggered: 0, reset: 0, notified: 0 };
      }
    }),
  );

  for (const outcome of outcomes) {
    result.evaluated += outcome.evaluated;
    result.triggered += outcome.triggered;
    result.reset += outcome.reset;
    result.notified += outcome.notified;
  }

  return result;
};
