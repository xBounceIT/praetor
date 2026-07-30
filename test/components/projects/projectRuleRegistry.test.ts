import { describe, expect, test } from 'bun:test';
import {
  getAvailableProjectRuleFields,
  getAvailableProjectRuleValueFields,
  getProjectRuleFieldDefinition,
  getProjectRuleValueLabelKey,
  isValidProjectRuleConditionValue,
  isValidProjectRuleValue,
  PROJECT_RULE_FIELD_DEFINITIONS,
} from '../../../components/projects/projectRuleRegistry';
import { PROJECT_RULE_FIELD_DEFINITIONS as SERVER_PROJECT_RULE_FIELD_DEFINITIONS } from '../../../server/utils/projectRuleFields.ts';

const comparableDefinitions = (
  definitions: readonly {
    id: string;
    kind: string;
    operators: readonly string[];
    enumValues?: readonly string[];
    requiresPermission?: string;
    group: string;
    periodOnly?: boolean;
  }[],
) =>
  definitions.map(({ id, kind, operators, enumValues, requiresPermission, group, periodOnly }) => ({
    id,
    kind,
    operators,
    enumValues: enumValues ? [...enumValues].sort() : undefined,
    requiresPermission,
    group,
    periodOnly,
  }));

describe('project rule registry', () => {
  test('keeps frontend definitions aligned with backend validation', () => {
    expect(comparableDefinitions(PROJECT_RULE_FIELD_DEFINITIONS)).toEqual(
      comparableDefinitions(SERVER_PROJECT_RULE_FIELD_DEFINITIONS),
    );
  });

  test('provides an Italian and English tooltip description for every condition field', async () => {
    const [italian, english] = await Promise.all([
      Bun.file(new URL('../../../locales/it/projects.json', import.meta.url)).json(),
      Bun.file(new URL('../../../locales/en/projects.json', import.meta.url)).json(),
    ]);

    for (const definition of PROJECT_RULE_FIELD_DEFINITIONS) {
      expect(italian.detail.rules.fieldDescriptions[definition.id]).toBeString();
      expect(english.detail.rules.fieldDescriptions[definition.id]).toBeString();
    }
  });

  test('filters cost-derived fields without reports.cost.view', () => {
    const fields = getAvailableProjectRuleFields(['projects.rules.create']).map(
      (field) => field.id,
    );
    expect(fields).toContain('revenue');
    expect(fields).not.toContain('cost_to_date');
    expect(fields).not.toContain('budget_used_pct');
  });

  test('keeps cost-derived fields when reports.cost.view is present', () => {
    const fields = getAvailableProjectRuleFields(['reports.cost.view']).map((field) => field.id);
    expect(fields).toContain('cost_to_date');
    expect(fields).toContain('budget_used_pct');
  });

  test('exposes enum operators and every effective value for billing type', () => {
    const definition = getProjectRuleFieldDefinition('billing_type');
    expect(definition?.operators).toEqual(['eq', 'neq']);
    expect(definition?.enumValues).toEqual(['time_and_materials', 'retainer', 'mixed']);
  });

  test('centralizes labels for project enums and booleans', () => {
    expect(getProjectRuleValueLabelKey('billing_type', 'time_and_materials')).toBe(
      'projects:projects.billingTypes.timeAndMaterials',
    );
    expect(getProjectRuleValueLabelKey('billing_frequency', 'one_time')).toBe(
      'projects:projects.billingFrequencies.oneTime',
    );
    expect(getProjectRuleValueLabelKey('tipo', 'interno')).toBe(
      'projects:projects.tipoValues.interno',
    );
    expect(getProjectRuleValueLabelKey('is_disabled', 'false')).toBe(
      'projects:detail.rules.values.boolean.false',
    );
  });

  test('validates number and enum values by field type', () => {
    expect(isValidProjectRuleValue('revenue', '1000')).toBe(true);
    expect(isValidProjectRuleValue('revenue', 'not-a-number')).toBe(false);
    expect(isValidProjectRuleValue('status', 'in_corso')).toBe(true);
    expect(isValidProjectRuleValue('status', 'archived')).toBe(false);
    expect(isValidProjectRuleValue('is_disabled', 'true')).toBe(true);
    expect(isValidProjectRuleValue('is_disabled', 'yes')).toBe(false);
  });

  test('exposes compatible target fields for field-to-field comparisons', () => {
    expect(
      getAvailableProjectRuleValueFields('revenue', ['reports.cost.view']).map((f) => f.id),
    ).toContain('cost_to_date');
    expect(getAvailableProjectRuleValueFields('revenue', []).map((f) => f.id)).not.toContain(
      'cost_to_date',
    );
    expect(getAvailableProjectRuleValueFields('status', []).map((f) => f.id)).not.toContain(
      'billing_type',
    );
  });

  test('validates field comparison values through the registry', () => {
    expect(
      isValidProjectRuleConditionValue({
        field: 'revenue',
        value: 'hours_to_date',
        valueType: 'field',
        permissions: [],
      }),
    ).toBe(true);
    expect(
      isValidProjectRuleConditionValue({
        field: 'status',
        value: 'billing_type',
        valueType: 'field',
        permissions: [],
      }),
    ).toBe(false);
  });

  test('exposes mutable project fields, omits technical links, and gates period metrics by mode', () => {
    const continuousFields = getAvailableProjectRuleFields([]).map((field) => field.id);
    const periodicFields = getAvailableProjectRuleFields([], 'periodic').map((field) => field.id);

    expect(continuousFields).toEqual(
      expect.arrayContaining([
        'project_name',
        'description',
        'is_disabled',
        'start_date',
        'end_date',
        'revenue',
        'billing_type',
        'billing_frequency',
        'status',
        'tipo',
        'tipo_confirmed',
      ]),
    );
    expect(continuousFields).not.toEqual(
      expect.arrayContaining([
        'project_id',
        'client_id',
        'created_at',
        'order_id',
        'offer_id',
        'offer_revision_code',
      ]),
    );
    expect(continuousFields).not.toContain('period_hours');
    expect(periodicFields).toContain('period_hours');
  });
});
