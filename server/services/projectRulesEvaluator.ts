import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as projectMetricsRepo from '../repositories/projectMetricsRepo.ts';
import * as projectRuleRecipientsRepo from '../repositories/projectRuleRecipientsRepo.ts';
import * as projectRulesRepo from '../repositories/projectRulesRepo.ts';
import { serializeError } from '../utils/logger.ts';
import { evaluateProjectRuleCondition } from '../utils/projectRuleFields.ts';

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

        return runAtomically(exec, async (tx) => {
          const acquired = await projectRulesRepo.markTriggeredOnRisingEdge(rule.id, now, tx);
          if (!acquired) return { evaluated: 1, triggered: 0, reset: 0, notified: 0 };

          const recipientUserIds = await projectRuleRecipientsRepo.resolveRecipientUserIds(
            rule.projectId,
            rule.actionConfig,
            tx,
          );
          const notified = await notificationsRepo.createForUsers(
            recipientUserIds,
            buildNotification(rule, metrics.projectName),
            tx,
          );
          return { evaluated: 1, triggered: 1, reset: 0, notified };
        });
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
