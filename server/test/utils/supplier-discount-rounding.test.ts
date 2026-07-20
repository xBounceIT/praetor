import { describe, expect, test } from 'bun:test';
import { preserveLegacyDiscountRounding } from '../../utils/supplier-discount-rounding.ts';

const normalized = () => [{ id: 'new-id', legacyDiscountRounding: false }];
const existing = [{ id: 'legacy-id', legacyDiscountRounding: true }];

describe('preserveLegacyDiscountRounding', () => {
  test('preserves a migrated marker by stable id when an older client omits the field', () => {
    expect(preserveLegacyDiscountRounding(normalized(), [{ id: 'legacy-id' }], existing)).toEqual([
      { id: 'new-id', legacyDiscountRounding: true },
    ]);
  });

  test('honors an explicit false value from a marker-aware client', () => {
    expect(
      preserveLegacyDiscountRounding(
        normalized(),
        [{ id: 'legacy-id', legacyDiscountRounding: false }],
        existing,
      ),
    ).toEqual([{ id: 'new-id', legacyDiscountRounding: false }]);
  });

  test('supports equal-length legacy payloads without ids by position', () => {
    expect(preserveLegacyDiscountRounding(normalized(), [{}], existing)).toEqual([
      { id: 'new-id', legacyDiscountRounding: true },
    ]);
  });

  test('does not inherit by position when rows were added or removed', () => {
    expect(
      preserveLegacyDiscountRounding(
        [
          { id: 'new-1', legacyDiscountRounding: false },
          { id: 'new-2', legacyDiscountRounding: false },
        ],
        [{}, {}],
        existing,
      ),
    ).toEqual([
      { id: 'new-1', legacyDiscountRounding: false },
      { id: 'new-2', legacyDiscountRounding: false },
    ]);
  });
});
