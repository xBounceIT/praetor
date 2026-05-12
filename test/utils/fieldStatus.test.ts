import { describe, expect, test } from 'bun:test';
import { getLinkedFieldStatus } from '../../utils/fieldStatus';

const baseOptions = {
  isReadOnly: false,
  isLinkedToSupplierQuote: false,
  readOnlyReason: 'read-only',
  supplierLockedReason: 'supplier-locked',
  statusEditable: 'editable',
};

describe('getLinkedFieldStatus', () => {
  test('returns the read-only reason when isReadOnly is true (highest priority)', () => {
    expect(getLinkedFieldStatus({ ...baseOptions, isReadOnly: true })).toBe('read-only');
  });

  test('read-only takes precedence even when also linked to a supplier quote', () => {
    expect(
      getLinkedFieldStatus({
        ...baseOptions,
        isReadOnly: true,
        isLinkedToSupplierQuote: true,
      }),
    ).toBe('read-only');
  });

  test('returns the supplier-locked reason when not read-only and linked to a supplier quote', () => {
    expect(getLinkedFieldStatus({ ...baseOptions, isLinkedToSupplierQuote: true })).toBe(
      'supplier-locked',
    );
  });

  test('returns the editable status when neither flag is set', () => {
    expect(getLinkedFieldStatus(baseOptions)).toBe('editable');
  });
});
