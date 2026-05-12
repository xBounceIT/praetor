import { describe, expect, test } from 'bun:test';
import { getBuildDate } from '../../scripts/build-date';

describe('getBuildDate', () => {
  test('returns a YYYYMMDD string for a fixed date', () => {
    expect(getBuildDate(new Date('2026-02-16T00:00:00Z'))).toBe('20260216');
  });

  test('zero-pads single-digit months and days', () => {
    expect(getBuildDate(new Date('2026-01-05T00:00:00Z'))).toBe('20260105');
  });

  test('formats the provided date as YYYYMMDD deterministically', () => {
    // Capture a single `now` and pass it explicitly so the assertion cannot
    // flake at midnight rollover between calls.
    const now = new Date();
    const expected = now.toISOString().slice(0, 10).replace(/-/g, '');
    expect(getBuildDate(now)).toBe(expected);
    expect(getBuildDate(now)).toMatch(/^\d{8}$/);
  });

  test('defaults to today when called without arguments', () => {
    expect(getBuildDate()).toMatch(/^\d{8}$/);
  });

  test('is not the hardcoded 20260216 placeholder when called for a different day', () => {
    expect(getBuildDate(new Date('2030-07-04T00:00:00Z'))).toBe('20300704');
  });
});
