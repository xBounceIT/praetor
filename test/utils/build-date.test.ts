import { describe, expect, test } from 'bun:test';
import { getBuildDate } from '../../scripts/build-date';

describe('getBuildDate', () => {
  test('returns a YYYYMMDD string for a fixed date', () => {
    expect(getBuildDate(new Date('2026-02-16T00:00:00Z'))).toBe('20260216');
  });

  test('zero-pads single-digit months and days', () => {
    expect(getBuildDate(new Date('2026-01-05T00:00:00Z'))).toBe('20260105');
  });

  test('without arguments returns today as YYYYMMDD', () => {
    const expected = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(getBuildDate()).toBe(expected);
    expect(getBuildDate()).toMatch(/^\d{8}$/);
  });

  test('is not the hardcoded 20260216 placeholder when called for a different day', () => {
    expect(getBuildDate(new Date('2030-07-04T00:00:00Z'))).toBe('20300704');
  });
});
