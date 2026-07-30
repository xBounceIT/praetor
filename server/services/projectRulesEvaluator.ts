import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as projectMetricsRepo from '../repositories/projectMetricsRepo.ts';
import * as projectRuleRecipientsRepo from '../repositories/projectRuleRecipientsRepo.ts';
import * as projectRulesRepo from '../repositories/projectRulesRepo.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { serializeError } from '../utils/logger.ts';
import {
  evaluateProjectRuleCondition,
  getProjectRuleFieldDefinition,
  isProjectRuleUnaryOperator,
} from '../utils/projectRuleFields.ts';
import {
  getAppTimeZone,
  getProjectRulePeriodForEvaluation,
  type ProjectRulePeriodWindow,
} from '../utils/projectRuleSchedule.ts';
import * as webhooksService from './webhooks.ts';

export const PROJECT_RULE_TRIGGERED_NOTIFICATION_TYPE = 'project_rule_triggered';
export const PROJECT_RULE_PERIODIC_METRICS_CONCURRENCY = 8;
export const PROJECT_RULE_EVALUATION_CONCURRENCY = 16;
export const PROJECT_RULE_WEBHOOK_CONCURRENCY = 4;

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

class InvalidProjectRuleScheduleFiltersError extends Error {
  constructor(readonly invalidFilters: { userIds: string[]; taskIds: string[] }) {
    super('Project rule schedule contains filters that are no longer valid');
    this.name = 'InvalidProjectRuleScheduleFiltersError';
  }
}

const buildNotification = (
  rule: projectRulesRepo.ProjectRule,
  projectName: string,
  period?: ProjectRulePeriodWindow,
) => ({
  type: PROJECT_RULE_TRIGGERED_NOTIFICATION_TYPE,
  title: 'Project rule triggered',
  message: `${rule.name} triggered for ${projectName}`,
  data: {
    projectId: rule.projectId,
    projectName,
    ruleId: rule.id,
    ruleName: rule.name,
    evaluationMode: rule.evaluationMode,
    ...(period ? { period } : {}),
  },
});

const buildWebhookPayload = (
  rule: projectRulesRepo.ProjectRule,
  metrics: projectMetricsRepo.ProjectRuleMetrics,
  now: Date,
  period?: ProjectRulePeriodWindow,
): webhooksService.WebhookDispatchPayload => {
  const payloadMetrics: Record<string, unknown> = {
    clientId: metrics.clientId,
    description: metrics.description,
    isDisabled: metrics.isDisabled,
    createdAt: metrics.createdAt,
    orderId: metrics.orderId,
    offerId: metrics.offerId,
    offerRevisionCode: metrics.offerRevisionCode,
    startDate: metrics.startDate,
    endDate: metrics.endDate,
    revenue: metrics.revenue,
    hoursToDate: metrics.hoursToDate,
    daysUntilDeadline: metrics.daysUntilDeadline,
    daysUntilStart: metrics.daysUntilStart,
    daysSinceStart: metrics.daysSinceStart,
    tasksCount: metrics.tasksCount,
    enabledTasksCount: metrics.enabledTasksCount,
    plannedEffortHours: metrics.plannedEffortHours,
    monthlyEffortHours: metrics.monthlyEffortHours,
    billingType: metrics.billingType,
    billingFrequency: metrics.billingFrequency,
    status: metrics.status,
    tipo: metrics.tipo,
    tipoConfirmed: metrics.tipoConfirmed,
    periodHours: metrics.periodHours,
    periodEntryCount: metrics.periodEntryCount,
    periodActiveUsers: metrics.periodActiveUsers,
    periodActiveTasks: metrics.periodActiveTasks,
  };

  if (ruleUsesPermissionGatedCostFields(rule)) {
    payloadMetrics.costToDate = metrics.costToDate;
    payloadMetrics.budgetUsedPct = metrics.budgetUsedPct;
    payloadMetrics.periodCost = metrics.periodCost;
  }

  return {
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
      evaluationMode: rule.evaluationMode,
      schedule: rule.schedule,
      ...(period ? { period } : {}),
    },
    metrics: payloadMetrics,
  };
};

const ruleUsesPermissionGatedCostFields = (rule: projectRulesRepo.ProjectRule): boolean => {
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

  return conditions.some((condition) => {
    const fieldDefinition = getProjectRuleFieldDefinition(condition.field);
    if (fieldDefinition?.requiresPermission === 'reports.cost.view') return true;
    if (condition.valueType !== 'field' || isProjectRuleUnaryOperator(condition.operator)) {
      return false;
    }
    const valueDefinition = getProjectRuleFieldDefinition(condition.value);
    return valueDefinition?.requiresPermission === 'reports.cost.view';
  });
};

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
  await mapWithConcurrency(webhookIds, PROJECT_RULE_WEBHOOK_CONCURRENCY, async (webhookId) => {
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
  });
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
  const appTimeZone = getAppTimeZone();
  const rules = await projectRulesRepo.listEnabled(exec);
  const continuousRules = rules.filter((rule) => rule.evaluationMode !== 'periodic');
  const periodicContexts = rules.flatMap((rule) => {
    if (rule.evaluationMode !== 'periodic') return [];
    const period = getProjectRulePeriodForEvaluation(
      now,
      rule.schedule,
      rule.lastEvaluatedPeriod,
      appTimeZone,
    );
    return rule.lastEvaluatedPeriod === period.key
      ? []
      : [
          {
            rule,
            period,
          },
        ];
  });
  const continuousMetricsByProjectId = await projectMetricsRepo.listForProjects(
    continuousRules.map((rule) => rule.projectId),
    now,
    exec,
    { timeZone: appTimeZone },
  );
  const periodicMetricsByScope = new Map<
    string,
    Promise<Map<string, projectMetricsRepo.ProjectRuleMetrics>>
  >();
  const periodicMetricResults = await mapWithConcurrency(
    periodicContexts,
    PROJECT_RULE_PERIODIC_METRICS_CONCURRENCY,
    async ({ rule, period }) => {
      try {
        const scopeKey = JSON.stringify([
          rule.projectId,
          period.startDate,
          period.endDate,
          appTimeZone,
          [...rule.schedule.userIds].sort(),
          [...rule.schedule.taskIds].sort(),
        ]);
        let metricsPromise = periodicMetricsByScope.get(scopeKey);
        if (!metricsPromise) {
          metricsPromise = projectMetricsRepo.listForProjects([rule.projectId], now, exec, {
            timeZone: appTimeZone,
            periodScope: {
              startDate: period.startDate,
              endDate: period.endDate,
              userIds: rule.schedule.userIds,
              taskIds: rule.schedule.taskIds,
            },
          });
          periodicMetricsByScope.set(scopeKey, metricsPromise);
        }
        const metrics = await metricsPromise;
        const projectMetrics = metrics.get(rule.projectId);
        const invalidPeriodUserIds = projectMetrics?.invalidPeriodUserIds ?? [];
        const invalidPeriodTaskIds = projectMetrics?.invalidPeriodTaskIds ?? [];
        if (invalidPeriodUserIds.length > 0 || invalidPeriodTaskIds.length > 0) {
          throw new InvalidProjectRuleScheduleFiltersError({
            userIds: invalidPeriodUserIds,
            taskIds: invalidPeriodTaskIds,
          });
        }
        return { ruleId: rule.id, metrics: projectMetrics, error: null };
      } catch (error) {
        return { ruleId: rule.id, metrics: undefined, error };
      }
    },
  );
  const periodicMetricsByRuleId = new Map(
    periodicMetricResults.map(({ ruleId, metrics }) => [ruleId, metrics]),
  );
  const periodicMetricErrorsByRuleId = new Map(
    periodicMetricResults
      .filter((result) => result.error !== null)
      .map(({ ruleId, error }) => [ruleId, error]),
  );
  const periodicContextByRuleId = new Map(
    periodicContexts.map(({ rule, period }) => [rule.id, period]),
  );

  const result: ProjectRulesEvaluationResult = {
    evaluated: 0,
    triggered: 0,
    reset: 0,
    notified: 0,
  };

  const outcomes = await mapWithConcurrency(
    rules,
    PROJECT_RULE_EVALUATION_CONCURRENCY,
    async (rule): Promise<ProjectRulesEvaluationResult> => {
      try {
        const period = periodicContextByRuleId.get(rule.id);
        if (rule.evaluationMode === 'periodic' && !period) {
          return { evaluated: 0, triggered: 0, reset: 0, notified: 0 };
        }
        const periodicMetricError = periodicMetricErrorsByRuleId.get(rule.id);
        if (periodicMetricError) throw periodicMetricError;
        const metrics =
          rule.evaluationMode === 'periodic'
            ? periodicMetricsByRuleId.get(rule.id)
            : continuousMetricsByProjectId.get(rule.projectId);
        const conditionMet = metrics !== undefined && evaluateRuleConditions(rule, metrics);

        if (rule.evaluationMode === 'periodic' && period) {
          const outcome = await runAtomically(exec, async (tx) => {
            const acquired = await projectRulesRepo.markPeriodicEvaluation(
              rule.id,
              period.key,
              conditionMet,
              now,
              rule.configVersion,
              tx,
            );
            if (!acquired || !conditionMet || !metrics) {
              return {
                evaluated: acquired ? 1 : 0,
                triggered: 0,
                reset: acquired && rule.conditionMet && !conditionMet ? 1 : 0,
                notified: 0,
                webhookIds: [] as string[],
                webhookPayload: null as webhooksService.WebhookDispatchPayload | null,
              };
            }
            const actionConfig = projectRulesRepo.normalizeProjectRuleActionConfig(
              rule.actionConfig,
            );
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
                    buildNotification(rule, metrics.projectName, period),
                    tx,
                  )
                : 0;
            return {
              evaluated: 1,
              triggered: 1,
              reset: 0,
              notified,
              webhookIds: actionConfig.webhookIds,
              webhookPayload: buildWebhookPayload(rule, metrics, now, period),
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
        }

        if (!conditionMet) {
          const reset = (await projectRulesRepo.markConditionNotMet(
            rule.id,
            rule.configVersion,
            exec,
          ))
            ? 1
            : 0;
          return { evaluated: 1, triggered: 0, reset, notified: 0 };
        }

        if (!metrics) return { evaluated: 1, triggered: 0, reset: 0, notified: 0 };

        const outcome = await runAtomically(exec, async (tx) => {
          const acquired = await projectRulesRepo.markTriggeredOnRisingEdge(
            rule.id,
            now,
            rule.configVersion,
            tx,
          );
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
        if (err instanceof InvalidProjectRuleScheduleFiltersError) {
          logWebhookWarning(
            logger,
            {
              ruleId: rule.id,
              projectId: rule.projectId,
              invalidScheduleFilters: err.invalidFilters,
            },
            'Project rule skipped because schedule filters are no longer valid',
          );
          return { evaluated: 0, triggered: 0, reset: 0, notified: 0 };
        }
        logger?.error(
          { err: serializeError(err), ruleId: rule.id, projectId: rule.projectId },
          'Project rule evaluation failed',
        );
        return { evaluated: 1, triggered: 0, reset: 0, notified: 0 };
      }
    },
  );

  for (const outcome of outcomes) {
    result.evaluated += outcome.evaluated;
    result.triggered += outcome.triggered;
    result.reset += outcome.reset;
    result.notified += outcome.notified;
  }

  return result;
};
