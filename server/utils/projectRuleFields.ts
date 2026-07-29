import { BILLING_FREQUENCIES, BILLING_TYPES } from './billing.ts';
import { PROJECT_STATUSES } from './projectStatus.ts';
import { PROJECT_TIPOS } from './projectTipo.ts';

export const PROJECT_RULE_NUMBER_OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'is_empty',
  'is_not_empty',
] as const;
export const PROJECT_RULE_ENUM_OPERATORS = ['eq', 'neq'] as const;
export const PROJECT_RULE_TEXT_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;
export const PROJECT_RULE_DATE_OPERATORS = [
  'before',
  'before_or_on',
  'after',
  'after_or_on',
  'eq',
  'neq',
  'is_empty',
  'is_not_empty',
] as const;
export const PROJECT_RULE_BOOLEAN_OPERATORS = ['is_true', 'is_false', 'eq', 'neq'] as const;
export const PROJECT_RULE_CONDITION_VALUE_TYPES = ['literal', 'field'] as const;

export type ProjectRuleNumberOperator = (typeof PROJECT_RULE_NUMBER_OPERATORS)[number];
export type ProjectRuleEnumOperator = (typeof PROJECT_RULE_ENUM_OPERATORS)[number];
export type ProjectRuleTextOperator = (typeof PROJECT_RULE_TEXT_OPERATORS)[number];
export type ProjectRuleDateOperator = (typeof PROJECT_RULE_DATE_OPERATORS)[number];
export type ProjectRuleBooleanOperator = (typeof PROJECT_RULE_BOOLEAN_OPERATORS)[number];
export type ProjectRuleOperator =
  | ProjectRuleNumberOperator
  | ProjectRuleEnumOperator
  | ProjectRuleTextOperator
  | ProjectRuleDateOperator
  | ProjectRuleBooleanOperator;
export type ProjectRuleConditionValueType = (typeof PROJECT_RULE_CONDITION_VALUE_TYPES)[number];

export const PROJECT_RULE_FIELD_IDS = [
  'project_id',
  'project_name',
  'client_id',
  'description',
  'is_disabled',
  'created_at',
  'order_id',
  'offer_id',
  'offer_revision_code',
  'start_date',
  'end_date',
  'revenue',
  'billing_type',
  'billing_frequency',
  'status',
  'tipo',
  'tipo_confirmed',
  'cost_to_date',
  'budget_used_pct',
  'hours_to_date',
  'days_until_deadline',
  'days_until_start',
  'days_since_start',
  'tasks_count',
  'enabled_tasks_count',
  'planned_effort_hours',
  'monthly_effort_hours',
  'period_hours',
  'period_entry_count',
  'period_active_users',
  'period_active_tasks',
  'period_cost',
] as const;

export type ProjectRuleField = (typeof PROJECT_RULE_FIELD_IDS)[number];
export type ProjectRuleFieldKind = 'number' | 'enum' | 'text' | 'date' | 'boolean';
export type ProjectRuleFieldGroup = 'project' | 'computed' | 'period';

export type ProjectRuleFieldDefinition = {
  id: ProjectRuleField;
  kind: ProjectRuleFieldKind;
  operators: readonly ProjectRuleOperator[];
  enumValues?: readonly string[];
  requiresPermission?: string;
  group: ProjectRuleFieldGroup;
  periodOnly?: boolean;
};

export const PROJECT_RULE_FIELD_DEFINITIONS: readonly ProjectRuleFieldDefinition[] = [
  {
    id: 'project_id',
    kind: 'text',
    operators: PROJECT_RULE_TEXT_OPERATORS,
    group: 'project',
  },
  {
    id: 'project_name',
    kind: 'text',
    operators: PROJECT_RULE_TEXT_OPERATORS,
    group: 'project',
  },
  { id: 'client_id', kind: 'text', operators: PROJECT_RULE_TEXT_OPERATORS, group: 'project' },
  { id: 'description', kind: 'text', operators: PROJECT_RULE_TEXT_OPERATORS, group: 'project' },
  {
    id: 'is_disabled',
    kind: 'boolean',
    operators: PROJECT_RULE_BOOLEAN_OPERATORS,
    group: 'project',
  },
  { id: 'created_at', kind: 'date', operators: PROJECT_RULE_DATE_OPERATORS, group: 'project' },
  { id: 'order_id', kind: 'text', operators: PROJECT_RULE_TEXT_OPERATORS, group: 'project' },
  { id: 'offer_id', kind: 'text', operators: PROJECT_RULE_TEXT_OPERATORS, group: 'project' },
  {
    id: 'offer_revision_code',
    kind: 'text',
    operators: PROJECT_RULE_TEXT_OPERATORS,
    group: 'project',
  },
  { id: 'start_date', kind: 'date', operators: PROJECT_RULE_DATE_OPERATORS, group: 'project' },
  { id: 'end_date', kind: 'date', operators: PROJECT_RULE_DATE_OPERATORS, group: 'project' },
  { id: 'revenue', kind: 'number', operators: PROJECT_RULE_NUMBER_OPERATORS, group: 'project' },
  {
    id: 'billing_type',
    kind: 'enum',
    operators: PROJECT_RULE_ENUM_OPERATORS,
    enumValues: BILLING_TYPES,
    group: 'project',
  },
  {
    id: 'billing_frequency',
    kind: 'enum',
    operators: PROJECT_RULE_ENUM_OPERATORS,
    enumValues: BILLING_FREQUENCIES,
    group: 'project',
  },
  {
    id: 'status',
    kind: 'enum',
    operators: PROJECT_RULE_ENUM_OPERATORS,
    enumValues: PROJECT_STATUSES,
    group: 'project',
  },
  {
    id: 'tipo',
    kind: 'enum',
    operators: PROJECT_RULE_ENUM_OPERATORS,
    enumValues: PROJECT_TIPOS,
    group: 'project',
  },
  {
    id: 'tipo_confirmed',
    kind: 'boolean',
    operators: PROJECT_RULE_BOOLEAN_OPERATORS,
    group: 'project',
  },
  {
    id: 'cost_to_date',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
    group: 'computed',
  },
  {
    id: 'budget_used_pct',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
    group: 'computed',
  },
  {
    id: 'hours_to_date',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'days_until_deadline',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'days_until_start',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'days_since_start',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'tasks_count',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'enabled_tasks_count',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'planned_effort_hours',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'monthly_effort_hours',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'computed',
  },
  {
    id: 'period_hours',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_entry_count',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_active_users',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_active_tasks',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    group: 'period',
    periodOnly: true,
  },
  {
    id: 'period_cost',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
    group: 'period',
    periodOnly: true,
  },
];

export const PROJECT_RULE_FIELDS = new Map(
  PROJECT_RULE_FIELD_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const getProjectRuleFieldDefinition = (field: string): ProjectRuleFieldDefinition | null =>
  PROJECT_RULE_FIELDS.get(field as ProjectRuleField) ?? null;

export const isProjectRuleField = (field: string): field is ProjectRuleField =>
  PROJECT_RULE_FIELDS.has(field as ProjectRuleField);

export const isProjectRuleOperator = (operator: string): operator is ProjectRuleOperator =>
  PROJECT_RULE_NUMBER_OPERATORS.includes(operator as ProjectRuleNumberOperator) ||
  PROJECT_RULE_ENUM_OPERATORS.includes(operator as ProjectRuleEnumOperator) ||
  PROJECT_RULE_TEXT_OPERATORS.includes(operator as ProjectRuleTextOperator) ||
  PROJECT_RULE_DATE_OPERATORS.includes(operator as ProjectRuleDateOperator) ||
  PROJECT_RULE_BOOLEAN_OPERATORS.includes(operator as ProjectRuleBooleanOperator);

export const isProjectRuleConditionValueType = (
  value: string,
): value is ProjectRuleConditionValueType =>
  PROJECT_RULE_CONDITION_VALUE_TYPES.includes(value as ProjectRuleConditionValueType);

export const isProjectRuleUnaryOperator = (operator: string): boolean =>
  operator === 'is_true' ||
  operator === 'is_false' ||
  operator === 'is_empty' ||
  operator === 'is_not_empty';

type ProjectRulePermissionCondition = {
  field: string;
  operator?: string;
  value: string;
  valueType?: string;
};

export const canViewProjectRule = (
  rule: {
    field: string;
    value: string;
    conditions?: readonly ProjectRulePermissionCondition[];
  },
  permissions: readonly string[],
): boolean => {
  const permissionSet = new Set(permissions);
  const conditions =
    rule.conditions && rule.conditions.length > 0
      ? rule.conditions
      : [{ field: rule.field, operator: '', value: rule.value, valueType: 'literal' }];

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

export const normalizeProjectRuleConditionValueType = (
  value: unknown,
): ProjectRuleConditionValueType => (value === 'field' ? 'field' : 'literal');

const enumValuesMatch = (
  leftValues: readonly string[] | undefined,
  rightValues: readonly string[] | undefined,
) => {
  if (!leftValues || !rightValues || leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
};

export const areProjectRuleFieldsComparable = (leftField: string, rightField: string): boolean => {
  const leftDefinition = getProjectRuleFieldDefinition(leftField);
  const rightDefinition = getProjectRuleFieldDefinition(rightField);
  if (!leftDefinition || !rightDefinition || leftDefinition.kind !== rightDefinition.kind) {
    return false;
  }
  if (leftDefinition.kind === 'enum') {
    return enumValuesMatch(leftDefinition.enumValues, rightDefinition.enumValues);
  }
  return true;
};

const normalizeNumericValue = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDateValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === trimmed
    ? trimmed
    : null;
};

export const validateProjectRuleCondition = ({
  field,
  operator,
  value,
  valueType = 'literal',
  permissions,
  evaluationMode = 'continuous',
}: {
  field: string;
  operator: string;
  value: string;
  valueType?: ProjectRuleConditionValueType | string;
  permissions?: readonly string[];
  evaluationMode?: 'continuous' | 'periodic';
}): { ok: true } | { ok: false; message: string } => {
  const definition = getProjectRuleFieldDefinition(field);
  if (!definition) return { ok: false, message: 'field must be a supported project rule field' };
  if (definition.periodOnly && evaluationMode !== 'periodic') {
    return { ok: false, message: `${field} requires periodic evaluation` };
  }
  if (definition.requiresPermission && !permissions?.includes(definition.requiresPermission)) {
    return { ok: false, message: `${field} requires ${definition.requiresPermission}` };
  }
  if (!definition.operators.includes(operator as ProjectRuleOperator)) {
    return { ok: false, message: 'operator is not valid for field' };
  }
  const normalizedValueType = normalizeProjectRuleConditionValueType(valueType);
  if (isProjectRuleUnaryOperator(operator)) {
    return normalizedValueType === 'literal'
      ? { ok: true }
      : { ok: false, message: 'unary operator cannot compare another field' };
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) return { ok: false, message: 'value is required' };

  if (normalizedValueType === 'field') {
    if (trimmedValue === field) {
      return { ok: false, message: 'value field cannot be the same as field' };
    }
    const valueDefinition = getProjectRuleFieldDefinition(trimmedValue);
    if (!valueDefinition) {
      return { ok: false, message: 'value field must be a supported project rule field' };
    }
    if (valueDefinition.periodOnly && evaluationMode !== 'periodic') {
      return { ok: false, message: `${trimmedValue} requires periodic evaluation` };
    }
    if (
      valueDefinition.requiresPermission &&
      !permissions?.includes(valueDefinition.requiresPermission)
    ) {
      return {
        ok: false,
        message: `${trimmedValue} requires ${valueDefinition.requiresPermission}`,
      };
    }
    return areProjectRuleFieldsComparable(field, trimmedValue)
      ? { ok: true }
      : { ok: false, message: 'value field is not compatible with field' };
  }

  if (definition.kind === 'number') {
    return normalizeNumericValue(trimmedValue) === null
      ? { ok: false, message: 'value must be a valid number' }
      : { ok: true };
  }
  if (definition.kind === 'date') {
    return normalizeDateValue(trimmedValue) === null
      ? { ok: false, message: 'value must be a valid ISO date' }
      : { ok: true };
  }
  if (definition.kind === 'text') return { ok: true };
  if (definition.kind === 'boolean') {
    return trimmedValue === 'true' || trimmedValue === 'false'
      ? { ok: true }
      : { ok: false, message: 'value must be true or false' };
  }
  if (!definition.enumValues?.includes(trimmedValue)) {
    return { ok: false, message: 'value is not valid for field' };
  }
  return { ok: true };
};

export const evaluateProjectRuleCondition = ({
  field,
  operator,
  expectedValue,
  expectedValueType = 'literal',
  actualValue,
  expectedActualValue,
}: {
  field: string;
  operator: string;
  expectedValue: string;
  expectedValueType?: ProjectRuleConditionValueType | string;
  actualValue: string | number | boolean | null | undefined;
  expectedActualValue?: string | number | boolean | null | undefined;
}): boolean => {
  const definition = getProjectRuleFieldDefinition(field);
  if (!definition?.operators.includes(operator as ProjectRuleOperator)) return false;

  if (operator === 'is_empty') {
    return actualValue === null || actualValue === undefined || actualValue === '';
  }
  if (operator === 'is_not_empty') {
    return actualValue !== null && actualValue !== undefined && String(actualValue).length > 0;
  }
  if (operator === 'is_true') return actualValue === true || actualValue === 'true';
  if (operator === 'is_false') return actualValue === false || actualValue === 'false';
  if (actualValue === null || actualValue === undefined) return false;

  const normalizedValueType = normalizeProjectRuleConditionValueType(expectedValueType);
  if (normalizedValueType === 'field' && !areProjectRuleFieldsComparable(field, expectedValue)) {
    return false;
  }

  if (definition.kind === 'number') {
    const expected =
      normalizedValueType === 'field'
        ? typeof expectedActualValue === 'number'
          ? expectedActualValue
          : expectedActualValue === null || expectedActualValue === undefined
            ? null
            : normalizeNumericValue(String(expectedActualValue))
        : normalizeNumericValue(expectedValue);
    const actual =
      typeof actualValue === 'number' ? actualValue : normalizeNumericValue(String(actualValue));
    if (expected === null || actual === null) return false;
    switch (operator) {
      case 'gt':
        return actual > expected;
      case 'gte':
        return actual >= expected;
      case 'lt':
        return actual < expected;
      case 'lte':
        return actual <= expected;
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      default:
        return false;
    }
  }

  const expected =
    normalizedValueType === 'field'
      ? expectedActualValue === null || expectedActualValue === undefined
        ? null
        : String(expectedActualValue)
      : expectedValue;
  if (expected === null) return false;

  if (definition.kind === 'date') {
    const actualDate = normalizeDateValue(String(actualValue));
    const expectedDate = normalizeDateValue(expected);
    if (!actualDate || !expectedDate) return false;
    switch (operator) {
      case 'before':
        return actualDate < expectedDate;
      case 'before_or_on':
        return actualDate <= expectedDate;
      case 'after':
        return actualDate > expectedDate;
      case 'after_or_on':
        return actualDate >= expectedDate;
      case 'eq':
        return actualDate === expectedDate;
      case 'neq':
        return actualDate !== expectedDate;
      default:
        return false;
    }
  }

  if (definition.kind === 'boolean') {
    const normalizeBoolean = (value: string | number | boolean): boolean | null => {
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return null;
    };
    const actualBoolean = normalizeBoolean(actualValue);
    const expectedBoolean = normalizeBoolean(expected);
    if (actualBoolean === null || expectedBoolean === null) return false;
    if (operator === 'eq') return actualBoolean === expectedBoolean;
    if (operator === 'neq') return actualBoolean !== expectedBoolean;
    return false;
  }

  const actual = String(actualValue);
  if (definition.kind === 'text') {
    switch (operator) {
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      case 'contains':
        return actual.includes(expected);
      case 'not_contains':
        return !actual.includes(expected);
      case 'starts_with':
        return actual.startsWith(expected);
      case 'ends_with':
        return actual.endsWith(expected);
      default:
        return false;
    }
  }

  if (!definition.enumValues?.includes(actual) || !definition.enumValues.includes(expected)) {
    return false;
  }
  if (operator === 'eq') return actual === expected;
  if (operator === 'neq') return actual !== expected;
  return false;
};
