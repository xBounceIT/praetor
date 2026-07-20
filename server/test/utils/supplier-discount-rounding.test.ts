import { describe, expect, test } from 'bun:test';
import {
  legacyDiscountRoundingForWrite,
  preserveLegacyDiscountRounding,
} from '../../utils/supplier-discount-rounding.ts';

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

  test('preserves an existing precise marker when an older client omits the field', () => {
    expect(
      preserveLegacyDiscountRounding(
        [{ id: 'new-id', legacyDiscountRounding: true }],
        [{ id: 'precise-id' }],
        [{ id: 'precise-id', legacyDiscountRounding: false }],
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

  test('keeps the compatibility marker on a newly inserted unmatched row', () => {
    expect(
      preserveLegacyDiscountRounding(
        [
          { id: 'new-1', legacyDiscountRounding: true },
          { id: 'new-2', legacyDiscountRounding: false },
        ],
        [{}, {}],
        existing,
      ),
    ).toEqual([
      { id: 'new-1', legacyDiscountRounding: true },
      { id: 'new-2', legacyDiscountRounding: false },
    ]);
  });
});

describe('legacyDiscountRoundingForWrite', () => {
  test('treats an omitted discounted write as legacy-compatible', () => {
    expect(legacyDiscountRoundingForWrite(undefined, 15)).toBe(true);
  });

  test('keeps omitted full-price writes precise and honors explicit markers', () => {
    expect(legacyDiscountRoundingForWrite(undefined, 0)).toBe(false);
    expect(legacyDiscountRoundingForWrite(false, 15)).toBe(false);
    expect(legacyDiscountRoundingForWrite(true, 0)).toBe(true);
  });
});
