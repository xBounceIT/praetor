import { describe, expect, test } from 'bun:test';
import { resolveCostForDate } from '../../repositories/userHourlyCostPeriodsRepo.ts';

const periods = [
  { effectiveFrom: null, costPerHour: 40 },
  { effectiveFrom: '2025-01-01', costPerHour: 50 },
  { effectiveFrom: '2025-07-15', costPerHour: 65 },
];

describe('userHourlyCostPeriodsRepo.resolveCostForDate', () => {
  test('uses the baseline before the first dated period', () => {
    expect(resolveCostForDate(periods, '2024-12-31')).toBe(40);
  });

  test('switches cost exactly on each effective date', () => {
    expect(resolveCostForDate(periods, '2025-01-01')).toBe(50);
    expect(resolveCostForDate(periods, '2025-07-14')).toBe(50);
    expect(resolveCostForDate(periods, '2025-07-15')).toBe(65);
  });

  test('keeps a future rate inactive until its effective date', () => {
    expect(
      resolveCostForDate(
        [...periods, { effectiveFrom: '2099-01-01', costPerHour: 100 }],
        '2026-01-01',
      ),
    ).toBe(65);
  });

  test('falls back to zero for an empty calendar', () => {
    expect(resolveCostForDate([], '2025-01-01')).toBe(0);
  });
});
