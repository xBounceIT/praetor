import { and, asc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import {
  type ProjectRuleActionConfig,
  type ProjectRuleCondition,
  type ProjectRuleConditionLogic,
  type ProjectRuleConditionValueType,
  projectRules,
} from '../db/schema/projectRules.ts';

export type { ProjectRuleCondition, ProjectRuleConditionLogic, ProjectRuleConditionValueType };

export type ProjectRule = {
  id: string;
  projectId: string;
  name: string;
  field: string;
  operator: string;
  value: string;
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleCondition[];
  actionType: string;
  actionConfig: ProjectRuleActionConfig;
  isEnabled: boolean;
  conditionMet: boolean;
  lastTriggeredAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NewProjectRule = {
  id: string;
  projectId: string;
  name: string;
  field: string;
  operator: string;
  value: string;
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleCondition[];
  actionType: string;
  actionConfig: ProjectRuleActionConfig;
  isEnabled: boolean;
  createdBy: string;
};

export type ProjectRuleUpdate = Partial<
  Pick<
    ProjectRule,
    | 'name'
    | 'field'
    | 'operator'
    | 'value'
    | 'conditionLogic'
    | 'conditions'
    | 'actionType'
    | 'actionConfig'
    | 'isEnabled'
  >
> & {
  resetCondition?: boolean;
};

const EMPTY_ACTION_CONFIG: ProjectRuleActionConfig = {
  recipientUserIds: [],
  recipientRoleIds: [],
};

const normalizeRecipientIds = (values: unknown): string[] =>
  Array.isArray(values)
    ? Array.from(
        new Set(
          values
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      )
    : [];

export const normalizeProjectRuleActionConfig = (
  value: ProjectRuleActionConfig | null | undefined,
): ProjectRuleActionConfig => ({
  recipientUserIds: normalizeRecipientIds(value?.recipientUserIds),
  recipientRoleIds: normalizeRecipientIds(value?.recipientRoleIds),
});

export const normalizeProjectRuleConditionLogic = (value: unknown): ProjectRuleConditionLogic =>
  value === 'or' ? 'or' : 'and';

export const normalizeProjectRuleConditionValueType = (
  value: unknown,
): ProjectRuleConditionValueType => (value === 'field' ? 'field' : 'literal');

const normalizeCondition = (value: unknown): ProjectRuleCondition | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const field = typeof raw.field === 'string' ? raw.field.trim() : '';
  const operator = typeof raw.operator === 'string' ? raw.operator.trim() : '';
  const conditionValue = typeof raw.value === 'string' ? raw.value.trim() : '';
  if (!field || !operator || !conditionValue) return null;
  return {
    field,
    operator,
    value: conditionValue,
    valueType: normalizeProjectRuleConditionValueType(raw.valueType),
  };
};

export const normalizeProjectRuleConditions = (
  value: unknown,
  fallback?: ProjectRuleCondition,
): ProjectRuleCondition[] => {
  const normalized = Array.isArray(value)
    ? value
        .map(normalizeCondition)
        .filter((condition): condition is ProjectRuleCondition => !!condition)
    : [];
  if (normalized.length > 0) return normalized;
  return fallback ? [fallback] : [];
};

const primaryConditionFor = (rule: Pick<ProjectRule, 'field' | 'operator' | 'value'>) => ({
  field: rule.field,
  operator: rule.operator,
  value: rule.value,
  valueType: 'literal' as const,
});

const mapRow = (row: typeof projectRules.$inferSelect): ProjectRule => {
  const fallback = primaryConditionFor(row);
  const conditions = normalizeProjectRuleConditions(row.conditions, fallback);
  const primary = conditions[0] ?? fallback;
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    field: primary.field,
    operator: primary.operator,
    value: primary.value,
    conditionLogic: normalizeProjectRuleConditionLogic(row.conditionLogic),
    conditions,
    actionType: row.actionType,
    actionConfig: normalizeProjectRuleActionConfig(row.actionConfig ?? EMPTY_ACTION_CONFIG),
    isEnabled: row.isEnabled,
    conditionMet: row.conditionMet,
    lastTriggeredAt: row.lastTriggeredAt?.getTime() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt?.getTime() ?? 0,
    updatedAt: row.updatedAt?.getTime() ?? 0,
  };
};

export const listByProject = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<ProjectRule[]> => {
  const rows = await exec
    .select()
    .from(projectRules)
    .where(eq(projectRules.projectId, projectId))
    .orderBy(asc(projectRules.name), asc(projectRules.createdAt));
  return rows.map(mapRow);
};

export const listEnabled = async (exec: DbExecutor = db): Promise<ProjectRule[]> => {
  const rows = await exec
    .select()
    .from(projectRules)
    .where(eq(projectRules.isEnabled, true))
    .orderBy(asc(projectRules.projectId), asc(projectRules.createdAt));
  return rows.map(mapRow);
};

export const findByProjectAndId = async (
  projectId: string,
  ruleId: string,
  exec: DbExecutor = db,
): Promise<ProjectRule | null> => {
  const rows = await exec
    .select()
    .from(projectRules)
    .where(and(eq(projectRules.projectId, projectId), eq(projectRules.id, ruleId)))
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
};

export const create = async (rule: NewProjectRule, exec: DbExecutor = db): Promise<ProjectRule> => {
  const conditions = normalizeProjectRuleConditions(rule.conditions, primaryConditionFor(rule));
  const primary = conditions[0] ?? primaryConditionFor(rule);
  const rows = await exec
    .insert(projectRules)
    .values({
      id: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      field: primary.field,
      operator: primary.operator,
      value: primary.value,
      conditionLogic: normalizeProjectRuleConditionLogic(rule.conditionLogic),
      conditions,
      actionType: rule.actionType,
      actionConfig: normalizeProjectRuleActionConfig(rule.actionConfig),
      isEnabled: rule.isEnabled,
      conditionMet: false,
      lastTriggeredAt: null,
      createdBy: rule.createdBy,
    })
    .returning();
  return mapRow(rows[0]);
};

export const update = async (
  projectId: string,
  ruleId: string,
  patch: ProjectRuleUpdate,
  exec: DbExecutor = db,
): Promise<ProjectRule | null> => {
  const set: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (patch.name !== undefined) set.name = patch.name;
  if (patch.conditionLogic !== undefined) {
    set.conditionLogic = normalizeProjectRuleConditionLogic(patch.conditionLogic);
  }
  if (patch.conditions !== undefined) {
    const conditions = normalizeProjectRuleConditions(patch.conditions);
    const primary = conditions[0];
    set.conditions = conditions;
    if (primary) {
      set.field = primary.field;
      set.operator = primary.operator;
      set.value = primary.value;
    }
  } else {
    if (patch.field !== undefined) set.field = patch.field;
    if (patch.operator !== undefined) set.operator = patch.operator;
    if (patch.value !== undefined) set.value = patch.value;
  }
  if (patch.actionType !== undefined) set.actionType = patch.actionType;
  if (patch.actionConfig !== undefined) {
    set.actionConfig = normalizeProjectRuleActionConfig(patch.actionConfig);
  }
  if (patch.isEnabled !== undefined) set.isEnabled = patch.isEnabled;
  if (patch.resetCondition) {
    set.conditionMet = false;
    set.lastTriggeredAt = null;
  }

  const rows = await exec
    .update(projectRules)
    .set(set)
    .where(and(eq(projectRules.projectId, projectId), eq(projectRules.id, ruleId)))
    .returning();
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteByProjectAndId = async (
  projectId: string,
  ruleId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .delete(projectRules)
    .where(and(eq(projectRules.projectId, projectId), eq(projectRules.id, ruleId)));
  return (result.rowCount ?? 0) > 0;
};

export const markConditionNotMet = async (
  ruleId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .update(projectRules)
    .set({ conditionMet: false, updatedAt: new Date() })
    .where(and(eq(projectRules.id, ruleId), eq(projectRules.conditionMet, true)));
  return (result.rowCount ?? 0) > 0;
};

export const markTriggeredOnRisingEdge = async (
  ruleId: string,
  now: Date,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .update(projectRules)
    .set({
      conditionMet: true,
      lastTriggeredAt: now,
      updatedAt: new Date(),
    })
    .where(and(eq(projectRules.id, ruleId), eq(projectRules.conditionMet, false)))
    .returning({ id: projectRules.id });
  return rows.length > 0;
};
