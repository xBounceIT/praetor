import { describe, expect, test } from 'bun:test';
import {
  evaluateProjectRuleCondition,
  validateProjectRuleCondition,
} from '../../utils/projectRuleFields.ts';

describe('projectRuleFields', () => {
  test('rejects cost-derived fields without reports.cost.view', () => {
    expect(
      validateProjectRuleCondition({
        field: 'budget_used_pct',
        operator: 'gte',
        value: '80',
        permissions: ['projects.rules.create'],
      }),
    ).toEqual({
      ok: false,
      message: 'budget_used_pct requires reports.cost.view',
    });
  });

  test('validates numeric and enum operators against the selected field', () => {
    expect(
      validateProjectRuleCondition({
        field: 'revenue',
        operator: 'gte',
        value: '1000',
        permissions: [],
      }),
    ).toEqual({ ok: true });
    expect(
      validateProjectRuleCondition({
        field: 'status',
        operator: 'gt',
        value: 'active',
        permissions: [],
      }),
    ).toEqual({ ok: false, message: 'operator is not valid for field' });
  });

  test('validates field-to-field comparisons and target permissions', () => {
    expect(
      validateProjectRuleCondition({
        field: 'revenue',
        operator: 'neq',
        value: 'cost_to_date',
        valueType: 'field',
        permissions: ['reports.cost.view'],
      }),
    ).toEqual({ ok: true });
    expect(
      validateProjectRuleCondition({
        field: 'revenue',
        operator: 'neq',
        value: 'cost_to_date',
        valueType: 'field',
        permissions: [],
      }),
    ).toEqual({ ok: false, message: 'cost_to_date requires reports.cost.view' });
    expect(
      validateProjectRuleCondition({
        field: 'revenue',
        operator: 'eq',
        value: 'revenue',
        valueType: 'field',
        permissions: [],
      }),
    ).toEqual({ ok: false, message: 'value field cannot be the same as field' });
    expect(
      validateProjectRuleCondition({
        field: 'status',
        operator: 'neq',
        value: 'billing_type',
        valueType: 'field',
        permissions: [],
      }),
    ).toEqual({ ok: false, message: 'value field is not compatible with field' });
  });

  test('treats null or missing metric values as not met', () => {
    expect(
      evaluateProjectRuleCondition({
        field: 'budget_used_pct',
        operator: 'gte',
        expectedValue: '80',
        actualValue: null,
      }),
    ).toBe(false);
  });

  test('evaluates numeric and enum comparisons', () => {
    expect(
      evaluateProjectRuleCondition({
        field: 'hours_to_date',
        operator: 'gt',
        expectedValue: '10',
        actualValue: 12,
      }),
    ).toBe(true);
    expect(
      evaluateProjectRuleCondition({
        field: 'billing_type',
        operator: 'eq',
        expectedValue: 'retainer',
        actualValue: 'retainer',
      }),
    ).toBe(true);
    expect(
      evaluateProjectRuleCondition({
        field: 'billing_type',
        operator: 'eq',
        expectedValue: 'retainer',
        actualValue: 'mixed',
      }),
    ).toBe(false);
    expect(
      evaluateProjectRuleCondition({
        field: 'billing_type',
        operator: 'neq',
        expectedValue: 'retainer',
        actualValue: 'mixed',
      }),
    ).toBe(true);
  });

  test('evaluates comparisons against another metric field', () => {
    expect(
      evaluateProjectRuleCondition({
        field: 'revenue',
        operator: 'gt',
        expectedValue: 'cost_to_date',
        expectedValueType: 'field',
        actualValue: 1000,
        expectedActualValue: 900,
      }),
    ).toBe(true);
    expect(
      evaluateProjectRuleCondition({
        field: 'revenue',
        operator: 'neq',
        expectedValue: 'cost_to_date',
        expectedValueType: 'field',
        actualValue: 1000,
        expectedActualValue: null,
      }),
    ).toBe(false);
  });

  test('rejects derived mixed billing as a rule value', () => {
    expect(
      validateProjectRuleCondition({
        field: 'billing_type',
        operator: 'eq',
        value: 'mixed',
        permissions: [],
      }),
    ).toEqual({ ok: false, message: 'value is not valid for field' });
    expect(
      evaluateProjectRuleCondition({
        field: 'billing_type',
        operator: 'neq',
        expectedValue: 'mixed',
        actualValue: 'retainer',
      }),
    ).toBe(false);
  });
});
