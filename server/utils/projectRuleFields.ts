export const PROJECT_RULE_NUMBER_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;
export const PROJECT_RULE_ENUM_OPERATORS = ['eq', 'neq'] as const;
export const PROJECT_RULE_CONDITION_VALUE_TYPES = ['literal', 'field'] as const;

export type ProjectRuleNumberOperator = (typeof PROJECT_RULE_NUMBER_OPERATORS)[number];
export type ProjectRuleEnumOperator = (typeof PROJECT_RULE_ENUM_OPERATORS)[number];
export type ProjectRuleOperator = ProjectRuleNumberOperator | ProjectRuleEnumOperator;
export type ProjectRuleConditionValueType = (typeof PROJECT_RULE_CONDITION_VALUE_TYPES)[number];

export const PROJECT_RULE_FIELD_IDS = [
  'revenue',
  'cost_to_date',
  'budget_used_pct',
  'hours_to_date',
  'days_until_deadline',
  'billing_type',
  'status',
] as const;

export type ProjectRuleField = (typeof PROJECT_RULE_FIELD_IDS)[number];
export type ProjectRuleFieldKind = 'number' | 'enum';

export type ProjectRuleFieldDefinition = {
  id: ProjectRuleField;
  kind: ProjectRuleFieldKind;
  operators: readonly ProjectRuleOperator[];
  enumValues?: readonly string[];
  requiresPermission?: string;
};

export const PROJECT_RULE_FIELD_DEFINITIONS: readonly ProjectRuleFieldDefinition[] = [
  { id: 'revenue', kind: 'number', operators: PROJECT_RULE_NUMBER_OPERATORS },
  {
    id: 'cost_to_date',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
  },
  {
    id: 'budget_used_pct',
    kind: 'number',
    operators: PROJECT_RULE_NUMBER_OPERATORS,
    requiresPermission: 'reports.cost.view',
  },
  { id: 'hours_to_date', kind: 'number', operators: PROJECT_RULE_NUMBER_OPERATORS },
  { id: 'days_until_deadline', kind: 'number', operators: PROJECT_RULE_NUMBER_OPERATORS },
  {
    id: 'billing_type',
    kind: 'enum',
    operators: PROJECT_RULE_ENUM_OPERATORS,
    enumValues: ['time_and_materials', 'retainer'],
  },
  {
    id: 'status',
    kind: 'enum',
    operators: PROJECT_RULE_ENUM_OPERATORS,
    enumValues: ['active', 'disabled'],
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
  PROJECT_RULE_ENUM_OPERATORS.includes(operator as ProjectRuleEnumOperator);

export const isProjectRuleConditionValueType = (
  value: string,
): value is ProjectRuleConditionValueType =>
  PROJECT_RULE_CONDITION_VALUE_TYPES.includes(value as ProjectRuleConditionValueType);

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

const runtimeEnumValuesForField = (field: string, definition: ProjectRuleFieldDefinition) =>
  field === 'billing_type' ? [...(definition.enumValues ?? []), 'mixed'] : definition.enumValues;

export const areProjectRuleFieldsComparable = (leftField: string, rightField: string): boolean => {
  const leftDefinition = getProjectRuleFieldDefinition(leftField);
  const rightDefinition = getProjectRuleFieldDefinition(rightField);
  if (!leftDefinition || !rightDefinition) return false;
  if (leftDefinition.kind !== rightDefinition.kind) return false;
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

export const validateProjectRuleCondition = ({
  field,
  operator,
  value,
  valueType = 'literal',
  permissions,
}: {
  field: string;
  operator: string;
  value: string;
  valueType?: ProjectRuleConditionValueType | string;
  permissions?: readonly string[];
}): { ok: true } | { ok: false; message: string } => {
  const definition = getProjectRuleFieldDefinition(field);
  if (!definition) return { ok: false, message: 'field must be a supported project rule field' };

  if (definition.requiresPermission && !permissions?.includes(definition.requiresPermission)) {
    return {
      ok: false,
      message: `${field} requires ${definition.requiresPermission}`,
    };
  }

  if (!definition.operators.includes(operator as ProjectRuleOperator)) {
    return { ok: false, message: 'operator is not valid for field' };
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) return { ok: false, message: 'value is required' };

  const normalizedValueType = normalizeProjectRuleConditionValueType(valueType);
  if (normalizedValueType === 'field') {
    if (trimmedValue === field) {
      return { ok: false, message: 'value field cannot be the same as field' };
    }
    const valueDefinition = getProjectRuleFieldDefinition(trimmedValue);
    if (!valueDefinition) {
      return { ok: false, message: 'value field must be a supported project rule field' };
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
    if (!areProjectRuleFieldsComparable(field, trimmedValue)) {
      return { ok: false, message: 'value field is not compatible with field' };
    }
    return { ok: true };
  }

  if (definition.kind === 'number') {
    if (normalizeNumericValue(trimmedValue) === null) {
      return { ok: false, message: 'value must be a valid number' };
    }
    return { ok: true };
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
  actualValue: string | number | null | undefined;
  expectedActualValue?: string | number | null | undefined;
}): boolean => {
  if (actualValue === null || actualValue === undefined) return false;

  const definition = getProjectRuleFieldDefinition(field);
  if (!definition?.operators.includes(operator as ProjectRuleOperator)) {
    return false;
  }

  if (definition.kind === 'number') {
    const normalizedValueType = normalizeProjectRuleConditionValueType(expectedValueType);
    if (normalizedValueType === 'field' && !areProjectRuleFieldsComparable(field, expectedValue)) {
      return false;
    }
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

  const actual = String(actualValue);
  if (normalizeProjectRuleConditionValueType(expectedValueType) === 'field') {
    if (!areProjectRuleFieldsComparable(field, expectedValue)) return false;
    if (expectedActualValue === null || expectedActualValue === undefined) return false;
    const expected = String(expectedActualValue);
    const actualEnumValues = runtimeEnumValuesForField(field, definition);
    const expectedDefinition = getProjectRuleFieldDefinition(expectedValue);
    const expectedEnumValues = expectedDefinition
      ? runtimeEnumValuesForField(expectedValue, expectedDefinition)
      : undefined;
    if (!actualEnumValues?.includes(actual) || !expectedEnumValues?.includes(expected)) {
      return false;
    }
    if (operator === 'eq') return actual === expected;
    if (operator === 'neq') return actual !== expected;
    return false;
  }

  const actualEnumValues = runtimeEnumValuesForField(field, definition);
  if (!definition.enumValues?.includes(expectedValue) || !actualEnumValues?.includes(actual)) {
    return false;
  }
  if (operator === 'eq') return actual === expectedValue;
  if (operator === 'neq') return actual !== expectedValue;
  return false;
};
