import { describe, expect, test } from 'bun:test';
import { formatBuildDate, getBuildDate } from '../scripts/buildDate.ts';

describe('formatBuildDate', () => {
  test('returns YYYYMMDD with zero-padded month and day', () => {
    // Use a local-time constructor (year, monthIndex, day) so the result
    // does not depend on the runner's timezone.
    expect(formatBuildDate(new Date(2026, 1, 16))).toBe('20260216');
    expect(formatBuildDate(new Date(2024, 0, 1))).toBe('20240101');
    expect(formatBuildDate(new Date(2030, 11, 31))).toBe('20301231');
  });

  test('pads single-digit months and days to two characters', () => {
    expect(formatBuildDate(new Date(2026, 8, 5))).toBe('20260905');
    expect(formatBuildDate(new Date(2026, 0, 9))).toBe('20260109');
  });

  test('does not return the previously hardcoded value for an arbitrary date', () => {
    // Guards against regression to the static literal '20260216'.
    expect(formatBuildDate(new Date(2027, 5, 4))).not.toBe('20260216');
    expect(formatBuildDate(new Date(2027, 5, 4))).toBe('20270604');
  });
});

describe('getBuildDate', () => {
  test('returns an 8-digit YYYYMMDD string for the current date', () => {
    const result = getBuildDate();
    expect(result).toMatch(/^\d{8}$/);
    expect(result).toBe(formatBuildDate(new Date()));
  });
});
