import type {
  Permission,
  ProjectRule,
  ProjectRuleConditionValueType,
  ProjectRuleEvaluationMode,
} from '../../types';
import { PROJECT_STATUSES, PROJECT_TIPOS } from '../../types';

const NUMBER_OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'is_empty',
  'is_not_empty',
] as const;
const ENUM_OPERATORS = ['eq', 'neq'] as const;
const TEXT_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;
const DATE_OPERATORS = [
  'before',
  'before_or_on',
  'after',
  'after_or_on',
  'eq',
  'neq',
  'is_empty',
  'is_not_empty',
] as const;
const BOOLEAN_OPERATORS = ['is_true', 'is_false', 'eq', 'neq'] as const;
const BILLING_TYPES = ['time_and_materials', 'retainer', 'mixed'] as const;
const BILLING_FREQUENCIES = ['monthly', 'one_time'] as const;

export type ProjectRuleOperator =
  | (typeof NUMBER_OPERATORS)[number]
  | (typeof ENUM_OPERATORS)[number]
  | (typeof TEXT_OPERATORS)[number]
  | (typeof DATE_OPERATORS)[number]
  | (typeof BOOLEAN_OPERATORS)[number];
export type ProjectRuleFieldKind = 'number' | 'enum' | 'text' | 'date' | 'boolean';
export type ProjectRuleFieldGroup = 'project' | 'computed' | 'period';

export type ProjectRuleFieldDefinition = {
  id: string;
  kind: ProjectRuleFieldKind;
  operators: readonly ProjectRuleOperator[];
  enumValues?: readonly string[];
  requiresPermission?: Permission;
  group: ProjectRuleFieldGroup;
  periodOnly?: boolean;
};

export const PROJECT_RULE_FIELD_DEFINITIONS: readonly ProjectRuleFieldDefinition[] = [
  { id: 'project_id', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'project_name', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'client_id', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'description', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'is_disabled', kind: 'boolean', operators: BOOLEAN_OPERATORS, group: 'project' },
  { id: 'created_at', kind: 'date', operators: DATE_OPERATORS, group: 'project' },
  { id: 'order_id', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'offer_id', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'offer_revision_code', kind: 'text', operators: TEXT_OPERATORS, group: 'project' },
  { id: 'start_date', kind: 'date', operators: DATE_OPERATORS, group: 'project' },
  { id: 'end_date', kind: 'date', operators: DATE_OPERATORS, group: 'project' },
  { id: 'revenue', kind: 'number', operators: NUMBER_OPERATORS, group: 'project' },
  {
    id: 'billing_type',
    kind: 'enum',
    operators: ENUM_OPERATORS,
    enumValues: BILLING_TYPES,
    group: 'project',
  },
  {
    id: 'billing_frequency',
    kind: 'enum',
    operators: ENUM_OPERATORS,
    enumValues: BILLING_FREQUENCIES,
    group: 'project',
  },
  {
    id: 'status',
    kind: 'enum',
    operators: ENUM_OPERATORS,
    enumValues: PROJECT_STATUSES,
    group: 'project',
  },
  {
    id: 'tipo',
    kind: 'enum',
    operators: ENUM_OPERATORS,
    enumValues: PROJECT_TIPOS,
    group: 'project',
  },
  { id: 'tipo_confirmed', kind: 'boolean', operators: BOOLEAN_OPERATORS, group: 'project' },
  {
    id: 'cost_to_date',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
    group: 'computed',
  },
  {
    id: 'budget_used_pct',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
    group: 'computed',
  },
  { id: 'hours_to_date', kind: 'number', operators: NUMBER_OPERATORS, group: 'computed' },
  {
    id: 'days_until_deadline',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'computed',
  },
  { id: 'days_until_start', kind: 'number', operators: NUMBER_OPERATORS, group: 'computed' },
  { id: 'days_since_start', kind: 'number', operators: NUMBER_OPERATORS, group: 'computed' },
  { id: 'tasks_count', kind: 'number', operators: NUMBER_OPERATORS, group: 'computed' },
  {
    id: 'enabled_tasks_count',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'planned_effort_hours',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'monthly_effort_hours',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'period_hours',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_entry_count',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_active_users',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_active_tasks',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_cost',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
    group: 'period',
    periodOnly: true,
  },
];

export const getProjectRuleFieldDefinition = (field: string) =>
  PROJECT_RULE_FIELD_DEFINITIONS.find((definition) => definition.id === field) ?? null;

export const getAvailableProjectRuleFields = (
  permissions: readonly string[],
  evaluationMode: ProjectRuleEvaluationMode = 'continuous',
) =>
  PROJECT_RULE_FIELD_DEFINITIONS.filter(
    (definition) =>
      (!definition.requiresPermission || permissions.includes(definition.requiresPermission)) &&
      (!definition.periodOnly || evaluationMode === 'periodic'),
  );

export const canViewProjectRule = (
  rule: Pick<ProjectRule, 'field' | 'value' | 'conditions'>,
  permissions: readonly string[],
): boolean => {
  const permissionSet = new Set(permissions);
  const conditions =
    rule.conditions?.length > 0
      ? rule.conditions
      : [{ field: rule.field, operator: '', value: rule.value, valueType: 'literal' as const }];
  return conditions.every((condition) => {
    const fieldPermission = getProjectRuleFieldDefinition(condition.field)?.requiresPermission;
    const valuePermission =
      condition.valueType === 'field' && !isProjectRuleUnaryOperator(condition.operator ?? '')
        ? getProjectRuleFieldDefinition(condition.value)?.requiresPermission
        : undefined;
    return (
      (!fieldPermission || permissionSet.has(fieldPermission)) &&
      (!valuePermission || permissionSet.has(valuePermission))
    );
  });
};

const enumValuesMatch = (
  leftValues: readonly string[] | undefined,
  rightValues: readonly string[] | undefined,
) =>
  Boolean(
    leftValues &&
      rightValues &&
      leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index]),
  );

const areFieldsComparable = (leftField: string, rightField: string) => {
  const left = getProjectRuleFieldDefinition(leftField);
  const right = getProjectRuleFieldDefinition(rightField);
  if (!left || !right || left.kind !== right.kind) return false;
  return left.kind !== 'enum' || enumValuesMatch(left.enumValues, right.enumValues);
};

export const getAvailableProjectRuleValueFields = (
  field: string,
  permissions: readonly string[],
  evaluationMode: ProjectRuleEvaluationMode = 'continuous',
) =>
  getAvailableProjectRuleFields(permissions, evaluationMode).filter(
    (definition) => definition.id !== field && areFieldsComparable(field, definition.id),
  );

export const isProjectRuleUnaryOperator = (operator: string) =>
  operator === 'is_true' ||
  operator === 'is_false' ||
  operator === 'is_empty' ||
  operator === 'is_not_empty';

export const getProjectRuleValueLabelKey = (field: string, value: string) => {
  if (field === 'billing_type') {
    if (value === 'time_and_materials') return 'projects:projects.billingTypes.timeAndMaterials';
    if (value === 'retainer') return 'projects:projects.billingTypes.retainer';
  }
  if (field === 'billing_frequency') {
    return `projects:projects.billingFrequencies.${value === 'one_time' ? 'oneTime' : value}`;
  }
  if (field === 'tipo') return `projects:projects.tipoValues.${value}`;
  if (field === 'is_disabled' || field === 'tipo_confirmed') {
    return `projects:detail.rules.values.boolean.${value}`;
  }
  return `projects:detail.rules.values.${field}.${value}`;
};

const isValidDate = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const date = new Date(`${trimmed}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === trimmed;
};

export const isValidProjectRuleValue = (field: string, value: string): boolean => {
  const definition = getProjectRuleFieldDefinition(field);
  if (!definition) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (definition.kind === 'number') return Number.isFinite(Number(trimmed));
  if (definition.kind === 'date') return isValidDate(trimmed);
  if (definition.kind === 'text') return true;
  if (definition.kind === 'boolean') return trimmed === 'true' || trimmed === 'false';
  return definition.enumValues?.includes(trimmed) ?? false;
};

export const isValidProjectRuleConditionValue = ({
  field,
  operator,
  value,
  valueType = 'literal',
  permissions,
  evaluationMode = 'continuous',
}: {
  field: string;
  operator?: string;
  value: string;
  valueType?: ProjectRuleConditionValueType;
  permissions: readonly string[];
  evaluationMode?: ProjectRuleEvaluationMode;
}) => {
  if (operator && isProjectRuleUnaryOperator(operator)) return true;
  if (valueType === 'field') {
    return getAvailableProjectRuleValueFields(field, permissions, evaluationMode).some(
      (definition) => definition.id === value,
    );
  }
  return isValidProjectRuleValue(field, value);
};
