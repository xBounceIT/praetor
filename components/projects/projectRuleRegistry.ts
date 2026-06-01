import type { Permission, ProjectRuleConditionValueType } from '../../types';

export const PROJECT_RULE_NUMBER_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;
export const PROJECT_RULE_ENUM_OPERATORS = ['eq', 'neq'] as const;
export const PROJECT_RULE_CONDITION_VALUE_TYPES = ['literal', 'field'] as const;

export type ProjectRuleNumberOperator = (typeof PROJECT_RULE_NUMBER_OPERATORS)[number];
export type ProjectRuleEnumOperator = (typeof PROJECT_RULE_ENUM_OPERATORS)[number];
export type ProjectRuleOperator = ProjectRuleNumberOperator | ProjectRuleEnumOperator;
export type ProjectRuleFieldKind = 'number' | 'enum';

export type ProjectRuleFieldDefinition = {
  id: string;
  kind: ProjectRuleFieldKind;
  operators: readonly ProjectRuleOperator[];
  enumValues?: readonly string[];
  requiresPermission?: Permission;
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

export const getProjectRuleFieldDefinition = (field: string) =>
  PROJECT_RULE_FIELD_DEFINITIONS.find((definition) => definition.id === field) ?? null;

export const getAvailableProjectRuleFields = (permissions: readonly string[]) =>
  PROJECT_RULE_FIELD_DEFINITIONS.filter(
    (definition) =>
      !definition.requiresPermission || permissions.includes(definition.requiresPermission),
  );

const enumValuesMatch = (
  leftValues: readonly string[] | undefined,
  rightValues: readonly string[] | undefined,
) => {
  if (!leftValues || !rightValues || leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
};

export const areProjectRuleFieldsComparable = (leftField: string, rightField: string) => {
  const leftDefinition = getProjectRuleFieldDefinition(leftField);
  const rightDefinition = getProjectRuleFieldDefinition(rightField);
  if (!leftDefinition || !rightDefinition) return false;
  if (leftDefinition.kind !== rightDefinition.kind) return false;
  if (leftDefinition.kind === 'enum') {
    return enumValuesMatch(leftDefinition.enumValues, rightDefinition.enumValues);
  }
  return true;
};

export const getAvailableProjectRuleValueFields = (field: string, permissions: readonly string[]) =>
  getAvailableProjectRuleFields(permissions).filter(
    (definition) => definition.id !== field && areProjectRuleFieldsComparable(field, definition.id),
  );

export const isValidProjectRuleValue = (field: string, value: string): boolean => {
  const definition = getProjectRuleFieldDefinition(field);
  if (!definition) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (definition.kind === 'number') return Number.isFinite(Number(trimmed));
  return definition.enumValues?.includes(trimmed) ?? false;
};

export const isValidProjectRuleConditionValue = ({
  field,
  value,
  valueType = 'literal',
  permissions,
}: {
  field: string;
  value: string;
  valueType?: ProjectRuleConditionValueType;
  permissions: readonly string[];
}) => {
  if (valueType === 'field') {
    return getAvailableProjectRuleValueFields(field, permissions).some(
      (definition) => definition.id === value,
    );
  }
  return isValidProjectRuleValue(field, value);
};
