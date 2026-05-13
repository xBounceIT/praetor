import { describe, expect, test } from 'bun:test';
import { computeEntryCost } from '../../utils/billing.ts';

describe('computeEntryCost', () => {
  test('returns 0 when duration is 0', () => {
    expect(computeEntryCost(0, 100)).toBe(0);
  });

  test('returns 0 when hourly cost is 0', () => {
    expect(computeEntryCost(5, 0)).toBe(0);
  });

  test('multiplies duration by hourly cost', () => {
    expect(computeEntryCost(2, 50)).toBe(100);
  });

  test('handles fractional hours', () => {
    expect(computeEntryCost(1.5, 100)).toBe(150);
  });

  test('rounds to 2 decimals (down)', () => {
    // 0.1 * 0.2 = 0.020000000000000004 in JS floats; rounding pins it to 0.02
    expect(computeEntryCost(0.1, 0.2)).toBe(0.02);
  });

  test('rounds halves up', () => {
    // 1 * 0.005 = 0.005 → 0.01
    expect(computeEntryCost(1, 0.005)).toBe(0.01);
  });

  test('matches duration * hourlyCost rounded to currency precision', () => {
    expect(computeEntryCost(6.5, 12.5)).toBe(81.25);
    expect(computeEntryCost(1, 0.015)).toBe(0.02);
  });

  test('handles negative duration as math allows (caller is responsible for validation)', () => {
    expect(computeEntryCost(-2, 50)).toBe(-100);
  });
});
