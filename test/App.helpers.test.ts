import { describe, expect, test } from 'bun:test';
import { canonicalizeLegacyHash, normalizeCurrencyForState, VALID_VIEWS } from '../utils/appShell';

describe('normalizeCurrencyForState', () => {
  test('maps the USD currency code to the dollar symbol', () => {
    expect(normalizeCurrencyForState('USD')).toBe('$');
  });

  test('passes through symbol-style values unchanged', () => {
    expect(normalizeCurrencyForState('€')).toBe('€');
    expect(normalizeCurrencyForState('$')).toBe('$');
    expect(normalizeCurrencyForState('£')).toBe('£');
  });

  test('leaves unknown ISO codes untouched (caller decides how to render)', () => {
    expect(normalizeCurrencyForState('CHF')).toBe('CHF');
  });
});

describe('VALID_VIEWS', () => {
  test('exposes a single shared view list (no duplicate copies in the module)', () => {
    expect(Array.isArray(VALID_VIEWS)).toBe(true);
    expect(VALID_VIEWS.length).toBeGreaterThan(0);
    const unique = new Set(VALID_VIEWS);
    expect(unique.size).toBe(VALID_VIEWS.length);
  });

  test('includes both project-management views so inline guards stay in sync with the route table', () => {
    expect(VALID_VIEWS).toContain('projects/manage');
    expect(VALID_VIEWS).toContain('projects/tasks');
  });

  test('includes the timesheet tracker that the default landing view falls back to', () => {
    expect(VALID_VIEWS).toContain('timesheets/tracker');
  });
});

describe('canonicalizeLegacyHash', () => {
  test('maps the legacy suppliers/manage path to crm/suppliers', () => {
    expect(canonicalizeLegacyHash('suppliers/manage')).toBe('crm/suppliers');
  });

  test('maps the legacy suppliers/quotes path to sales/supplier-quotes', () => {
    expect(canonicalizeLegacyHash('suppliers/quotes')).toBe('sales/supplier-quotes');
  });

  test('maps the legacy sales/supplier-offers path to sales/supplier-quotes', () => {
    expect(canonicalizeLegacyHash('sales/supplier-offers')).toBe('sales/supplier-quotes');
  });

  test('maps the legacy administration/work-units path to hr/work-units', () => {
    expect(canonicalizeLegacyHash('administration/work-units')).toBe('hr/work-units');
  });

  test('returns unrecognized paths unchanged', () => {
    expect(canonicalizeLegacyHash('timesheets/tracker')).toBe('timesheets/tracker');
    expect(canonicalizeLegacyHash('')).toBe('');
  });
});
