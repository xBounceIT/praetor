import { describe, expect, test } from 'bun:test';
import {
  getAvailableProjectRuleFields,
  getAvailableProjectRuleValueFields,
  getProjectRuleFieldDefinition,
  isValidProjectRuleConditionValue,
  isValidProjectRuleValue,
} from '../../../components/projects/projectRuleRegistry';

describe('project rule registry', () => {
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

  test('exposes enum operators and stored values for billing type', () => {
    const definition = getProjectRuleFieldDefinition('billing_type');
    expect(definition?.operators).toEqual(['eq', 'neq']);
    expect(definition?.enumValues).toEqual(['time_and_materials', 'retainer']);
    expect(definition?.enumValues).not.toContain('mixed');
  });

  test('validates number and enum values by field type', () => {
    expect(isValidProjectRuleValue('revenue', '1000')).toBe(true);
    expect(isValidProjectRuleValue('revenue', 'not-a-number')).toBe(false);
    expect(isValidProjectRuleValue('status', 'active')).toBe(true);
    expect(isValidProjectRuleValue('status', 'archived')).toBe(false);
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
});
